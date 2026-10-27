import type { Metadata } from "next";
import "./globals.css";
import "./redesign.css";
import "./system.css";
import "./product.css";
export const metadata: Metadata = {
  title: {
    default: "SingMotion AI — Your music. Your performance.",
    template: "%s · SingMotion AI",
  },
  description:
    "Create a singing performance from your own music and artist image. Explore the private, clearly simulated SingMotion studio.",
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
