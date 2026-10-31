import type { Metadata } from "next";
import "./globals.css";
import "./redesign.css";
import "./system.css";
import "./product.css";
import "./home-gallery.css";
import "./prompt-visibility.css";
import "./studio-refinement.css";
import "./login-brand.css";
import "./carousel.css";
export const metadata: Metadata = {
  title: {
    default: "SingMotion AI — Your music. Your performance.",
    template: "%s · SingMotion AI",
  },
  description:
    "Create a singing performance from your own music and photo in your private SingMotion studio.",
  icons: { icon: [{ url: "/api/brand-favicon?v=20261031", type: "image/png", sizes: "32x32" }], shortcut: "/api/brand-favicon?v=20261031", apple: "/api/brand-favicon?v=20261031" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
