import sharp from "sharp";
import fs from "fs";

const sizes = [16, 48, 128];
const input = "public/icons/x-clipper.svg";

if (!fs.existsSync(input)) {
  console.error("❌ public/icons/x-clipper.svg が存在しません");
  process.exit(1);
}

for (const size of sizes) {
  await sharp(input)
    .resize(size, size)
    .png()
    .toFile(`public/icons/x-clipper-${size}.png`);
  console.log(`✅ 生成: public/icons/x-clipper-${size}.png`);
}
