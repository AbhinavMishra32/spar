import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  images: {
    // The product screenshots are the only images, and they ship with the app.
    formats: ["image/avif", "image/webp"],
  },
};

export default config;
