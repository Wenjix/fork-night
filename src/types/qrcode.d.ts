declare module "qrcode" {
  const QRCode: {
    toString(text: string, options: { type: "svg"; errorCorrectionLevel: "M"; margin: number; width: number; color: { dark: string; light: string } }): Promise<string>;
  };
  export default QRCode;
}
