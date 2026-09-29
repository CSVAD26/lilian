let canvasWidth = 400;
let canvasHeight = 400;

function setup() {
  createCanvas(canvasWidth, canvasHeight);
}

function draw() {
  background(0, 255, 255);
  background(0);
  color(255, 0, 0);

  const headTopY = 100;
  const headBottomY = canvasHeight - 60;
  const earLength = 70;
  const earWidth = 40;
  const eyeOffsetX = 50;
  const eyeY = 130;
  const eyeLength = 200;
  const eyeWidth = 75;
  const pupilWidth = 4;

  // Head
  strokeWeight(0);
  fill(255, 80, 255);
  quad(
    canvasWidth / 2 - 60,
    headTopY,
    canvasWidth / 2 + 60,
    headTopY,
    canvasWidth / 2 + 140,
    headBottomY,
    canvasWidth / 2 - 140,
    headBottomY,
  );

  // Ears
  triangle(
    canvasWidth / 2 - 60,
    headTopY,
    canvasWidth / 2 - 60 + earWidth / 2,
    headTopY - earLength,
    canvasWidth / 2 - 60 + earWidth,
    headTopY,
  );
  triangle(
    canvasWidth / 2 + 60 - earWidth,
    headTopY,
    canvasWidth / 2 + 60 - earWidth / 2,
    headTopY - earLength,
    canvasWidth / 2 + 60,
    headTopY,
  );

  // Eyes
  strokeWeight(0);
  //fill(255, 255, 0);
  fill(0, 255, 255);
  arc(
    canvasWidth / 2 - eyeOffsetX,
    eyeY + eyeLength,
    eyeWidth,
    eyeLength * 2,
    PI,
    0,
  );
  arc(
    canvasWidth / 2 + eyeOffsetX,
    eyeY + eyeLength,
    eyeWidth,
    eyeLength * 2,
    PI,
    0,
  );

  // Pupils
  strokeWeight(0);
  fill(0);
  rect(canvasWidth / 2 - eyeOffsetX, eyeY, pupilWidth, eyeLength);
  rect(canvasWidth / 2 + eyeOffsetX - pupilWidth, eyeY, pupilWidth, eyeLength);

  // Cheeks
  strokeWeight(0);
  fill(255, 0, 0);
  ellipse(canvasWidth / 2 - 110, canvasHeight / 2 + 120, 15, 8);
  ellipse(canvasWidth / 2 + 110, canvasHeight / 2 + 120, 15, 8);
}
