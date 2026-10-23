import Link from "next/link";
import { Brand } from "./brand";
import { safeLink } from "../cms/policy";
export const defaultFooterLinks = [
  { label: "How it works", url: "/#how" },
  ...[
    "faq",
    "help",
    "contact",
    "pricing",
    "about",
    "privacy",
    "terms",
    "legal",
    "rights",
  ].map((p) => ({
    label:
      p === "faq"
        ? "FAQ"
        : p === "legal"
          ? "Legal notice"
          : p === "help"
            ? "Help & Tips"
            : p.charAt(0).toUpperCase() + p.slice(1),
    url: `/${p}`,
  })),
];
export function SiteFooter({
  links = defaultFooterLinks,
  copyright = "SingMotion AI · Development preview",
}: {
  links?: { label: string; url: string }[];
  copyright?: string;
}) {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <Brand />
        <nav aria-label="Footer navigation">
          {links
            .filter((item) => safeLink(item.url))
            .map((item) => (
              <Link key={item.url} href={item.url}>
                {item.label}
              </Link>
            ))}
        </nav>
        <small>{copyright}</small>
      </div>
    </footer>
  );
}
