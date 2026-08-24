// 3D logo from traced SVG
// Put wave.svg and badge.svg in the same folder as this file.

SIZE       = 80;   // badge width in mm
BADGE_H    = 6;    // badge thickness
WAVE_H     = 3;    // wave thickness
EMBOSSED   = true; // true = wave raised on badge, false = wave only
S          = SIZE / 2048;  // SVGs are 2048 x 2048 units

module wave()  scale([S, -S, 1]) import("wave.svg",  center = true, dpi = 96);
module badge() scale([S, -S, 1]) import("badge.svg", center = true, dpi = 96);

if (EMBOSSED) {
    linear_extrude(height = BADGE_H, convexity = 20) badge();
    translate([0, 0, BADGE_H])
        linear_extrude(height = WAVE_H, convexity = 20) wave();
} else {
    linear_extrude(height = WAVE_H, convexity = 20) wave();
}

// Variant: wave cut INTO the badge instead of raised.
// difference() {
//     linear_extrude(height = BADGE_H, convexity = 20) badge();
//     translate([0, 0, BADGE_H - 1.5])
//         linear_extrude(height = 2, convexity = 20) wave();
// }
