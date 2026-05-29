import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const repoName = process.env.NEXT_PUBLIC_REPO_NAME || "FC";
// 同一サイト内のサブパスに配置する場合に指定（例: 閲覧専用版を /<repo>/viewer/ に置く）
const subPath = process.env.NEXT_PUBLIC_BASE_SUBPATH || "";
const base = isProd ? `/${repoName}${subPath ? `/${subPath}` : ""}` : "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: base,
  assetPrefix: base ? `${base}/` : "",
  devIndicators: false,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
