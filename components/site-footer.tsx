import Link from "next/link";
import { Brand } from "./brand";
import { safeLink } from "../cms/policy";
export const defaultFooterLinks = [
  { label: "My Projects", url: "/projects" },
  { label: "Help", url: "/help" },
  { label: "Legals", url: "/legal" },
  { label: "Contact", url: "/contact" },
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
