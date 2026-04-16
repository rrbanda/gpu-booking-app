import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GPU Booking - Reserve GPU Resources",
  description: "Book and reserve H200 GPU resources with MIG partitioning",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-rh-gray-10 min-h-screen font-rh-text text-rh-gray-95">
        {children}
      </body>
    </html>
  );
}
