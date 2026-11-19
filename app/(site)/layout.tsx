import type { Metadata } from "next";
import {CustomerIdleGuard} from "@/components/customer-idle-guard";
import {seoPrelaunchMetadataRobots} from "@/lib/seo/search-pages";
import "./globals.css";
import "./redesign.css";
import "./system.css";
import "./product.css";
import "./home-gallery.css";
import "./prompt-visibility.css";
import "./studio-refinement.css";
import "./login-brand.css";
import "./carousel.css";
import "./site-navigation.css";
import "./seo-discovery.css";
export const metadata: Metadata = {
  metadataBase: new URL("https://www.singmotion.ai"),
  title: {
    default: "SingMotion AI — Your music. Your performance.",
    template: "%s · SingMotion AI",
  },
  description:
    "Create a singing performance from your own music and photo in your private SingMotion studio.",
  // Never advertise protected Production as indexable before full public approval.
  robots: seoPrelaunchMetadataRobots(),
  icons: { icon: [{ url: "/api/brand-favicon?v=20261101", type: "image/png", sizes: "32x32" }], shortcut: "/api/brand-favicon?v=20261101", apple: "/api/brand-favicon?v=20261101" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <CustomerIdleGuard/>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
