type Rgb = readonly [number, number, number];

type TextOptions = {
  size: number;
  bold?: boolean;
  color?: Rgb;
};

export type EnrollmentSlipPdfData = {
  fullName: string;
  email: string;
  status: string;
  track: string;
  cluster: string;
  section: string;
  adviser: string;
  applicationNumber: string;
  issuedAt: string;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

const DARK: Rgb = [0.043, 0.239, 0.18];
const GOLD: Rgb = [0.98, 0.8, 0.082];
const WHITE: Rgb = [1, 1, 1];
const TEXT: Rgb = [0.024, 0.157, 0.106];
const GRAY: Rgb = [0.294, 0.333, 0.388];
const BORDER: Rgb = [0.765, 0.886, 0.804];
const MINT: Rgb = [0.918, 0.961, 0.925];
const PALE_GOLD: Rgb = [0.996, 0.976, 0.886];

function toPdfText(value: string): string {
  let output = "";

  for (const character of value) {
    const code = character.codePointAt(0) ?? 63;

    if (code === 10 || code === 13 || code === 9) {
      output += " ";
    } else if (code >= 32 && code <= 255) {
      output += character;
    } else if (code === 0x2013 || code === 0x2014) {
      output += "-";
    } else if (code === 0x2018 || code === 0x2019) {
      output += "'";
    } else if (code === 0x201c || code === 0x201d) {
      output += '"';
    } else {
      output += "?";
    }
  }

  return output
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function rgb(color: Rgb): string {
  return color.map((value) => value.toFixed(3)).join(" ");
}

function textWidth(value: string, size: number, bold = false): number {
  return value.length * size * (bold ? 0.55 : 0.5);
}

function fitText(
  value: string,
  maxWidth: number,
  size: number,
  bold = false
): string {
  if (textWidth(value, size, bold) <= maxWidth) return value;

  let text = value;

  while (text.length > 1 && textWidth(`${text}...`, size, bold) > maxWidth) {
    text = text.slice(0, -1);
  }

  return `${text}...`;
}

class Canvas {
  private commands: string[] = [];

  fillRect(top: number, height: number, color: Rgb): this {
    const y = PAGE_HEIGHT - top - height;
    this.commands.push(`${rgb(color)} rg`, `0 ${y} ${PAGE_WIDTH} ${height} re f`);
    return this;
  }

  rect(
    x: number,
    top: number,
    width: number,
    height: number,
    color: Rgb,
    mode: "fill" | "stroke" = "fill"
  ): this {
    const y = PAGE_HEIGHT - top - height;

    if (mode === "fill") {
      this.commands.push(`${rgb(color)} rg`, `${x} ${y} ${width} ${height} re f`);
    } else {
      this.commands.push(
        `${rgb(color)} RG`,
        `0.8 w`,
        `${x} ${y} ${width} ${height} re S`
      );
    }

    return this;
  }

  line(
    x1: number,
    top1: number,
    x2: number,
    top2: number,
    color: Rgb,
    width = 1
  ): this {
    this.commands.push(
      `${rgb(color)} RG`,
      `${width} w`,
      `${x1} ${PAGE_HEIGHT - top1} m`,
      `${x2} ${PAGE_HEIGHT - top2} l S`
    );
    return this;
  }

  text(value: string, x: number, top: number, options: TextOptions): this {
    const font = options.bold ? "F2" : "F1";
    const color = options.color ?? TEXT;

    this.commands.push(
      `${rgb(color)} rg`,
      `BT /${font} ${options.size} Tf 1 0 0 1 ${x} ${
        PAGE_HEIGHT - top
      } Tm (${toPdfText(value)}) Tj ET`
    );

    return this;
  }

  centerText(value: string, top: number, options: TextOptions): this {
    const width = textWidth(value, options.size, options.bold);
    return this.text(value, (PAGE_WIDTH - width) / 2, top, options);
  }

  build(): string {
    return this.commands.join("\n");
  }
}

export function generateEnrollmentSlipPdf(
  data: EnrollmentSlipPdfData
): Buffer {
  const canvas = new Canvas();

  canvas.fillRect(0, 108, DARK);
  canvas.fillRect(104, 4, GOLD);
  canvas.text(
    "ANSELMO A. SANDOVAL MEMORIAL NATIONAL HIGH SCHOOL",
    40,
    44,
    { size: 15, bold: true, color: WHITE }
  );
  canvas.text("AASMNHS Online Enrollment System", 40, 65, {
    size: 10,
    color: MINT,
  });
  canvas.text("OFFICIAL ENROLLMENT SLIP", 40, 89, {
    size: 9,
    bold: true,
    color: GOLD,
  });

  canvas.text("This certifies that", 40, 158, { size: 12, color: GRAY });

  const nameSize =
    data.fullName.length > 44 ? 19 : data.fullName.length > 34 ? 22 : 26;

  canvas.text(fitText(data.fullName, 515, nameSize, true), 40, 198, {
    size: nameSize,
    bold: true,
    color: DARK,
  });
  canvas.line(40, 215, 555, 215, BORDER, 1.2);
  canvas.text(
    "is officially enrolled in the Senior High School program.",
    40,
    242,
    { size: 12, color: TEXT }
  );

  const statusText = `STATUS: ${data.status.toUpperCase()}`;
  const statusWidth = Math.max(150, textWidth(statusText, 10, true) + 42);
  canvas.rect(40, 262, statusWidth, 32, PALE_GOLD);
  canvas.rect(40, 262, 5, 32, GOLD);
  canvas.text(statusText, 58, 283, { size: 10, bold: true, color: DARK });

  const gridTop = 325;
  const gridHeight = 260;
  const colWidth = 257.5;

  canvas.rect(40, gridTop, 515, gridHeight, BORDER, "stroke");
  canvas.line(40, 390, 555, 390, BORDER, 0.8);
  canvas.line(40, 455, 555, 455, BORDER, 0.8);
  canvas.line(40, 520, 555, 520, BORDER, 0.8);
  canvas.line(297.5, 325, 297.5, 585, BORDER, 0.8);

  const rows = [
    [
      ["Application No.", data.applicationNumber],
      ["Status", data.status],
    ],
    [
      ["Senior High Track", data.track],
      ["Selected Cluster", data.cluster],
    ],
    [
      ["Assigned Section", data.section],
      ["Adviser", data.adviser],
    ],
    [
      ["Email Address", data.email],
      ["Date Issued", data.issuedAt],
    ],
  ];

  rows.forEach((row, rowIndex) => {
    row.forEach(([label, value], columnIndex) => {
      const x = 40 + columnIndex * colWidth + 16;
      const top = gridTop + rowIndex * 65;

      canvas.text(label.toUpperCase(), x, top + 22, {
        size: 8,
        bold: true,
        color: GRAY,
      });
      canvas.text(fitText(value || "Not provided", colWidth - 32, 11, true), x, top + 45, {
        size: 11,
        bold: true,
        color: TEXT,
      });
    });
  });

  canvas.rect(40, 610, 515, 68, MINT);
  canvas.text(
    "This document is system-generated and serves as proof of enrollment.",
    56,
    638,
    { size: 10, color: TEXT }
  );
  canvas.text(
    "Keep this slip for your records and present it when requested by the school.",
    56,
    658,
    { size: 9, color: GRAY }
  );

  canvas.line(40, 726, 250, 726, BORDER, 1);
  canvas.text("School Registrar", 40, 746, { size: 9, color: GRAY });
  canvas.line(345, 726, 555, 726, BORDER, 1);
  canvas.text("Date Issued", 345, 746, { size: 9, color: GRAY });
  canvas.text(data.issuedAt, 345, 718, { size: 10, bold: true, color: TEXT });

  canvas.fillRect(796, 46, DARK);
  canvas.centerText(
    "Anselmo A. Sandoval Memorial National High School | Online Enrollment System",
    822,
    { size: 8, color: WHITE }
  );

  const content = canvas.build();
  const objects: string[] = [];

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
    "/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>";
  objects[4] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[5] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[6] =
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n` +
    `${content}\nendstream`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];

  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(pdf, "latin1");
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");

  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";

  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdf +=
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}
