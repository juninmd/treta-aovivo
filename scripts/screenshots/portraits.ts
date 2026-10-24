/** Flat illustrated portraits drawn on a canvas: demo faces that belong to nobody. */

interface Look {
  bg: [string, string];
  skin: string;
  hair: string;
  suit: string;
  shirt: string;
  longHair?: boolean;
  bun?: boolean;
  glasses?: boolean;
  beard?: boolean;
}

const LOOKS: Look[] = [
  { bg: ["#1f3b33", "#0f1f1b"], skin: "#c98f6b", hair: "#3b2a22", suit: "#2f6f5e", shirt: "#e9efe9", bun: true, glasses: true },
  { bg: ["#24365c", "#121c33"], skin: "#e0b08f", hair: "#1c1410", suit: "#2c5aa0", shirt: "#f2f2f2", longHair: true },
  { bg: ["#4a2c2a", "#241413"], skin: "#a86f4f", hair: "#2a1d17", suit: "#5b5f66", shirt: "#dfe6ee", beard: true },
];

function draw(look: Look, size: number, shift: number): string {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const s = size / 160;
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, look.bg[0]);
  grad.addColorStop(1, look.bg[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.translate(shift * s, 0);
  const ellipse = (x: number, y: number, rx: number, ry: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x * s, y * s, rx * s, ry * s, 0, 0, Math.PI * 2);
    g.fill();
  };
  if (look.longHair) ellipse(80, 92, 40, 52, look.hair);
  // Shoulders, shirt and lapels.
  ellipse(80, 168, 62, 42, look.suit);
  g.fillStyle = look.shirt;
  g.beginPath();
  g.moveTo(66 * s, 128 * s);
  g.lineTo(80 * s, 152 * s);
  g.lineTo(94 * s, 128 * s);
  g.fill();
  ellipse(80, 118, 12, 14, look.skin);
  ellipse(80, 78, 30, 36, look.skin);
  if (look.beard) ellipse(80, 98, 24, 16, look.hair);
  ellipse(80, look.longHair ? 52 : 50, 32, look.longHair ? 22 : 18, look.hair);
  if (look.bun) ellipse(80, 34, 13, 11, look.hair);
  ellipse(69, 78, 3, 3.5, "#1b1b1b");
  ellipse(91, 78, 3, 3.5, "#1b1b1b");
  g.strokeStyle = "#7a3b32";
  g.lineWidth = 2.5 * s;
  g.beginPath();
  g.arc(80 * s, 92 * s, 9 * s, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  if (look.glasses) {
    g.strokeStyle = "#20262c";
    g.lineWidth = 2 * s;
    for (const x of [69, 91]) {
      g.beginPath();
      g.arc(x * s, 78 * s, 8 * s, 0, Math.PI * 2);
      g.stroke();
    }
  }
  return c.toDataURL("image/jpeg", 0.9);
}

/** A few shots per voice so the app picks one automatically (it needs at least three). */
export function portraitsFor(speaker: number): { image: string; faceWidth: number; hash: string; score: number }[] {
  const look = LOOKS[speaker % LOOKS.length];
  return [0, -3, 3, 1].map((shift, i) => ({ image: draw(look, 160, shift), faceWidth: 120 - i * 4, hash: "0f0f0f0f0f0f0f0f", score: 0.9 }));
}
