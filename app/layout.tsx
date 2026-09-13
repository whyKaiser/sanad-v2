import type { Metadata } from "next";
import "./globals.css";
import "./integrated.css";

export const metadata: Metadata = {
  title: "سَنَد ٢ | الوثيقة والثقة والقرار",
  description: "حفظ وثائق السفر واسترجاعها ومراجعتها بمساعدة ذكية مرتبطة بالمصادر. نموذج تجريبي ببيانات اصطناعية.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
