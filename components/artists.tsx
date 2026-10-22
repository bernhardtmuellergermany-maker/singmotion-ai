"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  Upload,
  Check,
  Trash2,
  Pencil,
  ImagePlus,
  X,
} from "lucide-react";
import { api, ensureSession, upload } from "@/lib/client";
import {
  views,
  validateFile,
  type Artist,
  type ArtistImage,
} from "@/lib/domain";
export function ArtistLibrary({
  onSelect,
  selected,
}: {
  onSelect?: (artist: Artist, imageId: string) => void;
  selected?: string;
}) {
  const [artists, setArtists] = useState<Artist[]>([]),
    [editing, setEditing] = useState<Artist | null>(null),
    [showForm, setShowForm] = useState(false),
    [name, setName] = useState(""),
    [images, setImages] = useState<ArtistImage[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    ensureSession()
      .then(() => api<Artist[]>("artists"))
      .then(setArtists)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  function edit(a: Artist | null) {
    setEditing(a);
    setName(a?.name || "");
    setImages(a?.images || []);
    setShowForm(true);
    setError("");
  }
  async function add(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      validateFile(file.name, file.size, "image");
      const a = await upload(file, "image");
      setImages((prev) => [...prev, { assetId: a.id, label: "Front" }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const a = await api<Artist>(`artists${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({ name, images }),
      });
      setArtists((prev) => [a, ...prev.filter((x) => x.id !== a.id)]);
      setShowForm(false);
      if (onSelect) onSelect(a, a.images[0].assetId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(a: Artist) {
    if (
      !confirm(`Delete ${a.name}'s artist profile? Existing projects are kept.`)
    )
      return;
    try {
      await api(`artists/${a.id}`, { method: "DELETE" });
      setArtists((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="artist-library">
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {showForm ? (
        <div className="artist-form">
          <div className="section-heading">
            <h3>{editing ? "Edit artist" : "Meet your new artist"}</h3>
            <button
              className="icon-button"
              aria-label="Close artist editor"
              onClick={() => setShowForm(false)}
            >
              <X size={19} />
            </button>
          </div>
          <label>
            Artist name
            <input
              autoFocus
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Emma Taylor"
            />
          </label>
          <p className="quiet">
            Upload your own singer reference. A clear face and visible mouth are
            a great starting point.
          </p>
          <div className="reference-grid">
            {images.map((im, index) => (
              <div key={im.assetId} className="reference-tile">
                <img
                  src={`/api/assets/${im.assetId}`}
                  alt={`${name || "Artist"} reference ${index + 1}`}
                />
                <label className="sr-only" htmlFor={`view-${index}`}>
                  Reference view {index + 1}
                </label>
                <select
                  id={`view-${index}`}
                  value={im.label}
                  onChange={(e) =>
                    setImages((prev) =>
                      prev.map((x, i) =>
                        i === index ? { ...x, label: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {views.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                <button
                  className="text-button"
                  onClick={() =>
                    setImages((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            {images.length < 8 && (
              <label className="reference-add">
                <ImagePlus size={26} />
                <span>{busy ? "Uploading…" : "Add reference"}</span>
                <input
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={busy}
                  onChange={(e) => void add(e.target.files?.[0])}
                />
              </label>
            )}
          </div>
          <small className="quiet">
            JPEG or PNG · up to 30 MB · max. 4096 × 4096. Originals remain
            private. Only one reference is used per generation.
          </small>
          <button
            className="button primary"
            disabled={busy || !name.trim() || !images.length}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save artist"}
          </button>
        </div>
      ) : (
        <>
          <div className="section-heading">
            <p className="quiet">Your artists, ready for their next song.</p>
            <button className="button subtle small" onClick={() => edit(null)}>
              <Plus size={16} /> Add artist
            </button>
          </div>
          {loading ? (
            <p className="quiet">Loading your artists…</p>
          ) : artists.length === 0 ? (
            <button
              className="empty-state clickable"
              onClick={() => edit(null)}
            >
              <ImagePlus size={35} />
              <h3>A face for your music.</h3>
              <p>Add your first artist with a reference image you own.</p>
              <span className="text-button">
                <Upload size={16} /> Upload an artist
              </span>
            </button>
          ) : (
            <div className="artists-grid">
              {artists.map((a) => (
                <article className="artist-card" key={a.id}>
                  <div className="artist-image">
                    <img
                      src={`/api/assets/${a.images[0].assetId}`}
                      alt={a.name}
                    />
                  </div>
                  <div className="artist-card-body">
                    <h3>{a.name}</h3>
                    <small>
                      {a.images.length} reference{" "}
                      {a.images.length === 1 ? "image" : "images"}
                    </small>
                    {onSelect && (
                      <div className="reference-choices">
                        {a.images.map((im) => (
                          <button
                            key={im.assetId}
                            className={`reference-choice ${selected === im.assetId ? "selected" : ""}`}
                            onClick={() => onSelect(a, im.assetId)}
                          >
                            <img src={`/api/assets/${im.assetId}`} alt="" />
                            <span>{im.label}</span>
                            {selected === im.assetId && <Check size={13} />}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="artist-actions">
                      <button className="text-button" onClick={() => edit(a)}>
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Delete ${a.name}`}
                        onClick={() => void remove(a)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
