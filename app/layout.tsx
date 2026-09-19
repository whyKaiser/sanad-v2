import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./integrated.css";

export const metadata: Metadata = {
  title: "سَنَد | الوثيقة والثقة والقرار",
  description: "حفظ وثائق السفر واسترجاعها ومراجعتها بمساعدة ذكية مرتبطة بالمصادر. نموذج تجريبي ببيانات اصطناعية.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1620" },
  ],
};

/* Applies the saved theme before first paint. Without this the page would
   render light and then flip, which reads as a bug on a dark-mode device. */
const themeBoot = `(function(){try{var t=localStorage.getItem("sanad-theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
