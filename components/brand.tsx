import Link from "next/link";
export function Mark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      {[12, 25, 38, 24, 12].map((h, i) => (
        <i key={i} style={{ height: h }} />
      ))}
    </span>
  );
}
export function Brand() {
  return (
    <Link className="brand wordmark" href="/" aria-label="SingMotion home">
      singmotion<span>.</span>
    </Link>
  );
}
