-- Supabase foundation only. NOT applied automatically and NOT a live integration.
-- All writes remain service-only pending verified auth/MFA and financial RPC tests.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TYPE public.job_state AS ENUM ('queued','processing','completed','failed','cancelled');
CREATE TYPE public.ledger_kind AS ENUM ('purchase','reservation','capture','restoration','admin_adjustment','refund','reversal');
CREATE TABLE public.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 display_name text CHECK (length(display_name)<=80), suspended boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.user_roles (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id), role text NOT NULL CHECK (role IN ('customer','admin'))
);
CREATE TABLE public.assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
 kind text NOT NULL CHECK (kind IN ('audio','image','video')), object_key text UNIQUE NOT NULL,
 mime_type text NOT NULL, bytes bigint NOT NULL CHECK (bytes>0), duration_ms bigint CHECK (duration_ms>0),
 width integer CHECK (width BETWEEN 1 AND 4096), height integer CHECK (height BETWEEN 1 AND 4096),
 expires_at timestamptz, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id)
);
CREATE TABLE public.artists (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id)
);
CREATE TABLE public.artist_reference_images (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
 artist_id uuid NOT NULL, asset_id uuid NOT NULL,
 view_label text NOT NULL CHECK (view_label IN ('Front','Three-Quarter','Side','Full Body','Custom')),
 FOREIGN KEY(artist_id,user_id) REFERENCES public.artists(id,user_id),
 FOREIGN KEY(asset_id,user_id) REFERENCES public.assets(id,user_id)
);
CREATE TABLE public.projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
 title text NOT NULL, saved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id)
);
CREATE TABLE public.price_configurations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cents_per_ten_seconds integer NOT NULL CHECK (cents_per_ten_seconds>0),
 currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'), minimum_billable_ms integer CHECK(minimum_billable_ms>0),
 tax_description text NOT NULL, active_from timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.generation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id), project_id uuid NOT NULL,
 song_asset_id uuid NOT NULL, primary_image_asset_id uuid NOT NULL, output_asset_id uuid,
 idempotency_key text NOT NULL, state public.job_state NOT NULL DEFAULT 'queued', provider text,
 provider_job_id text, start_ms integer NOT NULL CHECK (start_ms>=0), end_ms integer NOT NULL,
 composed_prompt text NOT NULL CHECK(length(composed_prompt)<=2000), price_configuration_id uuid REFERENCES public.price_configurations(id),
 customer_price_cents integer NOT NULL CHECK(customer_price_cents>0), demo boolean NOT NULL DEFAULT true,
 lease_expires_at timestamptz, error_code text, completed_at timestamptz, consent_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_ms>start_ms AND end_ms-start_ms<=300000), UNIQUE(user_id,idempotency_key), UNIQUE(id,user_id),
 UNIQUE(provider,provider_job_id),
 FOREIGN KEY(project_id,user_id) REFERENCES public.projects(id,user_id),
 FOREIGN KEY(song_asset_id,user_id) REFERENCES public.assets(id,user_id),
 FOREIGN KEY(primary_image_asset_id,user_id) REFERENCES public.assets(id,user_id),
 FOREIGN KEY(output_asset_id,user_id) REFERENCES public.assets(id,user_id)
);
CREATE TABLE public.provider_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.generation_jobs(id),
 request_key text UNIQUE NOT NULL, provider text NOT NULL, provider_job_id text, status text NOT NULL,
 cost_microusd bigint CHECK(cost_microusd>=0), billable_duration_ms bigint,
 response_metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.purchases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
 stripe_checkout_id text UNIQUE, payment_intent_id text UNIQUE, status text NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents>0), currency text NOT NULL DEFAULT 'EUR',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id)
);
CREATE TABLE public.credit_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
 job_id uuid, purchase_id uuid, kind public.ledger_kind NOT NULL, amount_cents bigint NOT NULL,
 idempotency_key text UNIQUE NOT NULL, reason text, created_by uuid REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(job_id,user_id) REFERENCES public.generation_jobs(id,user_id),
 FOREIGN KEY(purchase_id,user_id) REFERENCES public.purchases(id,user_id),
 CHECK(kind<>'admin_adjustment' OR (length(trim(reason))>0 AND created_by IS NOT NULL))
);
CREATE UNIQUE INDEX one_job_ledger_event ON public.credit_ledger(job_id,kind) WHERE job_id IS NOT NULL;
CREATE TABLE public.payment_events (
 stripe_event_id text PRIMARY KEY, purchase_id uuid REFERENCES public.purchases(id),
 processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.admin_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES public.profiles(id),
 action text NOT NULL, target_id uuid, reason text NOT NULL CHECK(length(trim(reason))>0),
 metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.reject_immutable_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Append-only records cannot be updated or deleted'; END $$;
CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON public.credit_ledger FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_mutation();
CREATE TRIGGER immutable_admin_audit BEFORE UPDATE OR DELETE ON public.admin_audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_mutation();
CREATE TRIGGER immutable_payment_events BEFORE UPDATE OR DELETE ON public.payment_events FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_mutation();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','user_roles','assets','artists','artist_reference_images','projects','price_configurations','generation_jobs','provider_requests','purchases','credit_ledger','payment_events','admin_audit_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
 END LOOP;
END $$;
GRANT SELECT ON public.profiles, public.artists, public.artist_reference_images, public.projects, public.generation_jobs, public.purchases, public.credit_ledger TO authenticated;
CREATE POLICY own_profile_read ON public.profiles FOR SELECT TO authenticated USING(id=auth.uid());
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['artists','artist_reference_images','projects','generation_jobs','purchases','credit_ledger'] LOOP
  EXECUTE format('CREATE POLICY own_read ON public.%I FOR SELECT TO authenticated USING(user_id=auth.uid())',t);
 END LOOP;
END $$;
-- Assets/object keys, roles, provider costs, prices, audit and webhook metadata are
-- service-only. No administrator privilege is inferred from user-editable metadata.
COMMIT;
