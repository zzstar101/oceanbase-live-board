// Bun 打包器对图片默认用 file loader：import 得到打包后（带 hash）的 URL
declare module '*.svg' {
  const url: string;
  export default url;
}
declare module '*.png' {
  const url: string;
  export default url;
}
