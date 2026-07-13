import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Recovery Intelligence — Convin × RBL Bank",
  description: "AI collections performance dashboard: how much credit-card outstanding Convin's AI voice agents recovered for RBL Bank — recovery, entity validation, and intelligence.",
};

// Set the theme class before first paint so dark mode never flashes.
const THEME_INIT = `try{var t=localStorage.getItem('cvtheme');if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {children}
      </body>
    </html>
  );
}
