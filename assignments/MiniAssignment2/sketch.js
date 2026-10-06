// Triadic Tetradic Color Palette
// Mouse position changes base hue value. Four squares show triadic/tetradic colors (base, base +30, base +60, base +90).
// extended from Rune Madsen's Color Scheme Analogous Example :https://printingcode.runemadsen.com/examples/color/scheme_analogous/index.html

// Modification: Generate grid palette of color cells based on chosen colors (changes on mouse move)

let outerRadius = 200;
let innerRadius = 0; // hole size
let steps = 360 / 15; // resolution
let mode = "triadic"; // change to 'tetradic' for tetradic colors

// Grid vars
let numRows = 20;
let numCols = 20;
let grid = new Array(numRows);

let gridMode = "static";
let prevMouseX = 0;

function setup() {
  createCanvas(800, 800);
  colorMode(HSB, 360, 100, 100);
  noStroke();
}

function draw() {
  background(100);
  drawRing();
  if (mode === "triadic") {
    drawTriadicColors();
  } else if (mode === "tetradic") {
    drawTetradicColors();
  }
  fill(0);
  text("click to toggle mode", 50, height - 50);

  // New stuff
  let baseHue = map(mouseX, 0, width, 0, 360);

  if (gridMode !== "static" || mouseX !== prevMouseX || prevMouseX === 0) {
    if (mode === "triadic") {
      let triadicHues = [
        baseHue % 360,
        (baseHue + 120) % 360,
        (baseHue + 240) % 360,
      ];
      generateGrid(triadicHues);
    } else if (mode === "tetradic") {
      let tetradicHues = [
        baseHue % 360,
        (baseHue + 90) % 360,
        (baseHue + 180) % 360,
        (baseHue + 270) % 360,
      ];
      generateGrid(tetradicHues);
    }
  }

  drawGrid();
  prevMouseX = mouseX;
}

function mousePressed() {
  if (mode === "triadic") {
    mode = "tetradic";
  } else if (mode === "tetradic") {
    mode = "triadic";
  }
  prevMouseX = 0; // reset prevMouseX to force grid regeneration on next draw
}

function drawGrid() {
  // Draw a grid of cells, each filled with a randomly chosen color from the palette
  for (let i = 0; i < numRows; i++) {
    for (let j = 0; j < numCols; j++) {
      fill(grid[i][j], 100, 100);
      rect(
        (i * width) / numRows,
        height / 5 + (j * height) / numCols,
        width / numRows,
        height / numCols,
      );
    }
  }
}

// Generate grid from passed in hues
function generateGrid(hues) {
  // Build a 2D array of color cells
  for (let i = 0; i < numRows; i++) {
    grid[i] = new Array(numCols);
    for (let j = 0; j < numCols; j++) {
      let hueNum = Math.floor(random() * hues.length);
      grid[i][j] = hues[hueNum];
    }
  }
}

function drawTriadicColors() {
  // Map mouseX to hue (0–360)
  let baseHue = map(mouseX, 0, width, 0, 360);

  let squareWidth = width / 3;
  // Square 1: base hue
  fill((baseHue + 0) % 360, 100, 100);
  rect(0, 0, squareWidth, height / 6);
  drawColorPosition(baseHue);

  // Square 2: base + 120
  fill((baseHue + 120) % 360, 100, 100);
  rect(squareWidth, 0, squareWidth, height / 6);
  drawColorPosition(baseHue + 120);

  // Square 3: base + 240
  fill((baseHue + 240) % 360, 100, 100);
  rect(squareWidth * 2, 0, squareWidth, height / 6);
  drawColorPosition(baseHue + 240);
}

function drawTetradicColors() {
  // Map mouseX to hue (0–360)
  let baseHue = map(mouseX, 0, width, 0, 360);

  let squareWidth = width / 4;
  // Square 1: base hue
  fill((baseHue + 0) % 360, 100, 100);
  rect(0, 0, squareWidth, height / 6);
  drawColorPosition(baseHue);

  // Square 2: base + 90
  fill((baseHue + 90) % 360, 100, 100);
  rect(squareWidth, 0, squareWidth, height / 6);
  drawColorPosition(baseHue + 90);

  // Square 3: base + 180
  fill((baseHue + 180) % 360, 100, 100);
  rect(squareWidth * 2, 0, squareWidth, height / 6);
  drawColorPosition(baseHue + 180);

  // Square 4: base + 270
  fill((baseHue + 270) % 360, 100, 100);
  rect(squareWidth * 3, 0, squareWidth, height / 6);
  drawColorPosition(baseHue + 270);
}

function drawColorPosition(hue) {
  push();
  translate(width / 2, height / 2);
  let x1 = cos(radians(hue)) * (innerRadius + (outerRadius - innerRadius) / 2);
  let y1 = sin(radians(hue)) * (innerRadius + (outerRadius - innerRadius) / 2);
  fill(0);
  ellipse(x1, y1, 20, 20);
  pop();
}

function drawRing() {
  push();
  translate(width / 2, height / 2); // center of canvas

  for (let angle = 0; angle < 360; angle += steps) {
    let nextAngle = angle + steps;

    // Outer edge points
    let x1 = cos(radians(angle)) * outerRadius;
    let y1 = sin(radians(angle)) * outerRadius;
    let x2 = cos(radians(nextAngle)) * outerRadius;
    let y2 = sin(radians(nextAngle)) * outerRadius;

    // Inner edge points
    let x3 = cos(radians(nextAngle)) * innerRadius;
    let y3 = sin(radians(nextAngle)) * innerRadius;
    let x4 = cos(radians(angle)) * innerRadius;
    let y4 = sin(radians(angle)) * innerRadius;

    fill(angle, 100, 100);
    quad(x1, y1, x2, y2, x3, y3, x4, y4);
  }
  pop();
}
