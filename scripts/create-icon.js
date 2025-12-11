const sharp = require("sharp");
const path = require("path");

// Create a 128x128 PNG icon from SVG
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#2d5aa8"/>
      <stop offset="100%" style="stop-color:#1a365d"/>
    </linearGradient>
  </defs>
  <rect width="24" height="24" rx="4" fill="url(#bg)"/>
  <path fill="#ffffff" d="M12 4c-1.1 0-2 .9-2 2v2H7c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2h-3V6c0-1.1-.9-2-2-2zm0 1.5c.28 0 .5.22.5.5v2h-1V6c0-.28.22-.5.5-.5zM7 9.5h10c.28 0 .5.22.5.5v8c0 .28-.22.5-.5.5H7c-.28 0-.5-.22-.5-.5v-8c0-.28.22-.5.5-.5z"/>
  <path fill="#4fc3f7" d="M12 11l3 3h-2v3h-2v-3H9l3-3z"/>
  <circle cx="19" cy="5" r="3" fill="#4caf50"/>
  <path fill="#ffffff" d="M18.3 6.5l-.8-.8 1-1-.5-.5-1 1-.8-.8-.4.4 2.1 2.1z"/>
</svg>`;

sharp(Buffer.from(svgContent))
  .resize(128, 128)
  .png()
  .toFile(path.join(__dirname, "..", "media", "icon.png"))
  .then(() => console.log("Icon created successfully!"))
  .catch((err) => console.error("Error creating icon:", err));
