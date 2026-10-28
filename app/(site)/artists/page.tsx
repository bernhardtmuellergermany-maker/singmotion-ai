import { Shell } from "@/components/shell";
import { ArtistLibrary } from "@/components/artists";
export default function Page() {
  return (
    <Shell>
      <div id="content">
        <div className="page-heading">
          <div>
            <span className="eyebrow">THE PEOPLE BEHIND THE PERFORMANCE</span>
            <h1>My artists</h1>
            <p>A familiar face. A new song. Build your own cast of artists.</p>
          </div>
        </div>
        <ArtistLibrary />
      </div>
    </Shell>
  );
}
