// core/cinemaFx.js
//
// Safe "Cinema FX" pack compatible with ffmpeg
// - No sin/PI/t expressions
// - Just scaling, cropping, grading, lens, motion blur

function getCinemaFxFilters(target = "normal") {
  if (target === "short") {
    return [
      // Vertical 9:16 base
      "scale=1080:1920:force_original_aspect_ratio=decrease",
      "pad=1080:1920:(ow-iw)/2:(oh-ih)/2",

      // Slight zoom punch
      "scale=iw*1.05:ih*1.05",
      "crop=1080:1920",

      // Teal/blue grade
      "lutrgb=r='val*0.95':g='val*1.10':b='val*1.12'",

      // Lens distortion
      "lenscorrection=k1=-0.12:k2=0.02",

      // Motion blur
      "tblend=all_mode=average"
    ].join(",");
  }

  // Normal 16:9 landscape
  return [
    "scale=1920:-2",

    // Slight zoom punch
    "scale=iw*1.05:ih*1.05",
    "crop=1920:1080",

    // Color grade
    "lutrgb=r='val*0.95':g='val*1.05':b='val*1.07'",

    // Lens distortion
    "lenscorrection=k1=-0.08:k2=0.02",

    // Motion blur
    "tblend=all_mode=average"
  ].join(",");
}

module.exports = { getCinemaFxFilters };
