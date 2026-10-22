-- Reservation RPC is service-only. Caller MUST verify Supabase identity, suspension,
-- resource ownership, quote freshness, consent, limits and provider readiness first.
BEGIN;
CREATE FUNCTION public.reserve_job_credits(p_user uuid,p_job uuid,p_amount bigint,p_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE existing public.credit_ledger; total bigint; result uuid; actual bigint;
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=p_user AND NOT suspended FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable customer'; END IF;
 SELECT * INTO existing FROM public.credit_ledger WHERE idempotency_key=p_key;
 IF FOUND THEN
  IF existing.user_id<>p_user OR existing.job_id IS DISTINCT FROM p_job OR existing.amount_cents<>-p_amount OR existing.kind<>'reservation' THEN RAISE EXCEPTION 'Idempotency conflict'; END IF;
  RETURN existing.id;
 END IF;
 SELECT customer_price_cents INTO actual FROM public.generation_jobs WHERE id=p_job AND user_id=p_user AND state='queued';
 IF NOT FOUND OR actual<>p_amount OR p_amount<=0 THEN RAISE EXCEPTION 'Invalid job reservation'; END IF;
 SELECT COALESCE(sum(amount_cents),0) INTO total FROM public.credit_ledger WHERE user_id=p_user;
 IF total<p_amount THEN RAISE EXCEPTION 'Insufficient credits'; END IF;
 INSERT INTO public.credit_ledger(user_id,job_id,kind,amount_cents,idempotency_key) VALUES(p_user,p_job,'reservation',-p_amount,p_key) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.reserve_job_credits(uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_job_credits(uuid,uuid,bigint,text) TO service_role;
-- Capture is a zero-delta reservation settlement. Technical failure/cancellation
-- restores the reserved amount exactly once. Purchases, refunds, restorations and
-- admin adjustments need audited transactional RPCs and integration tests before use.
COMMIT;
