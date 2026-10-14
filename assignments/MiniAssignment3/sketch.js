let img;
let outImg;
let edgeImg;
let cvReady = false;
let k = 3; // number of clusters
const imageGap = 20; // gap between two images
let overlay = false; // whether to overlay edge image on top of segmented image
let blurSize = 3;
let lowThreshold = 50;
let highThreshold = 150;

function onOpenCvReady() {
  document.getElementById("status").innerText = "OpenCV.js is ready ✅";
  cvReady = true;
}

function setup() {
  createCanvas(800, 800);
  noLoop();
  // Let user upload an image
  createFileInput(handleFile).position(400, 100);
}

function handleFile(file) {
  if (file.type === "image") {
    img = loadImage(file.data, () => {
      resizeCanvas(img.width * 2 + imageGap, img.height);
      if (cvReady) {
        segmentImage();
        edgeDetectionImage();
        renderResults();
      } else {
        console.log("OpenCV not ready yet.");
      }
    });
  }
}

// Draw resulting images onto canvas
function renderResults() {
  if (!img) return;

  background(255);
  blendMode(BLEND);
  if (outImg) image(outImg, 0, 0);
  if (edgeImg) {
    if (overlay) {
      blendMode(LIGHTEST);
      image(edgeImg, 0, 0);
    } else {
      image(edgeImg, img.width + imageGap, 0);
    }
  }
}

function matToP5Image(mat) {
  const p5Img = createImage(mat.cols, mat.rows);
  p5Img.loadPixels();

  let rgba = mat;
  if (mat.type() === cv.CV_8UC1) {
    rgba = new cv.Mat();
    cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
  } else if (mat.type() === cv.CV_8UC3) {
    rgba = new cv.Mat();
    cv.cvtColor(mat, rgba, cv.COLOR_RGB2RGBA);
  }

  p5Img.pixels.set(rgba.data);
  p5Img.updatePixels();

  if (rgba !== mat) {
    rgba.delete();
  }

  return p5Img;
}

function segmentImage() {
  if (!img || !cvReady) return;

  // Convert p5 image to cv.Mat
  img.loadPixels();
  let src = cv.matFromImageData(
    img.canvas.getContext("2d").getImageData(0, 0, img.width, img.height),
  );

  // Convert RGBA to RGB
  let rgb = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);

  // Apply Gaussian blur
  let blurred = new cv.Mat();
  let kSize = Math.max(1, blurSize);
  if (kSize % 2 === 0) kSize += 1;
  cv.GaussianBlur(
    rgb,
    blurred,
    new cv.Size(kSize, kSize),
    0,
    0,
    cv.BORDER_DEFAULT,
  );
  rgb = blurred;

  /* K-means processing */
  let rows = rgb.rows;
  let cols = rgb.cols;
  let channels = rgb.channels();
  let sampleCount = rows * cols;

  // Flatten the image into N x 3 float matrix
  let samples = new cv.Mat(sampleCount, channels, cv.CV_32F);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      for (let c = 0; c < channels; c++) {
        samples.floatPtr(y * cols + x)[c] = rgb.ucharPtr(y, x)[c];
      }
    }
  }

  // K-means
  let labels = new cv.Mat();
  let centers = new cv.Mat();
  let criteria = new cv.TermCriteria(
    cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER,
    1,
    1.0,
  );
  cv.kmeans(samples, k, labels, criteria, 3, cv.KMEANS_PP_CENTERS, centers);

  // Reconstruct clustered image
  let clustered = new cv.Mat(rows, cols, rgb.type());
  for (let i = 0; i < sampleCount; i++) {
    let clusterIdx = labels.intAt(i, 0);
    let y = Math.floor(i / cols);
    let x = i % cols;
    for (let c = 0; c < channels; c++) {
      clustered.ucharPtr(y, x)[c] = centers.floatAt(clusterIdx, c);
    }
  }

  // Convert back to RGBA
  let dst = new cv.Mat();
  cv.cvtColor(clustered, dst, cv.COLOR_RGB2RGBA);
  outImg = matToP5Image(dst);

  // Cleanup
  src.delete();
  rgb.delete();
  samples.delete();
  labels.delete();
  centers.delete();
  clustered.delete();
  dst.delete();
}

function edgeDetectionImage() {
  if (!img || !cvReady) return;

  // Convert p5 image to cv.Mat
  img.loadPixels();
  let src = cv.matFromImageData(
    img.canvas.getContext("2d").getImageData(0, 0, img.width, img.height),
  );

  // Convert RGBA to RGB
  let rgb = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);

  // Convert to grayscale image
  let gray = new cv.Mat();
  cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);

  // Apply Gaussian blur
  let blurred = new cv.Mat();
  let kSize = Math.max(1, blurSize);
  if (kSize % 2 === 0) kSize += 1;
  cv.GaussianBlur(
    gray,
    blurred,
    new cv.Size(kSize, kSize),
    0,
    0,
    cv.BORDER_DEFAULT,
  );

  let edges = new cv.Mat();
  cv.Canny(blurred, edges, lowThreshold, highThreshold);
  edgeImg = matToP5Image(edges);

  // Cleanup
  src.delete();
  rgb.delete();
  gray.delete();
  blurred.delete();
  edges.delete();
}

// Update blur and thresholds for edge detection according to slider
function updateEdgeControls() {
  blurSize = Number(document.getElementById("blurSize").value);
  lowThreshold = Number(document.getElementById("lowThreshold").value);
  highThreshold = Number(document.getElementById("highThreshold").value);

  if (img && cvReady) {
    //segmentImage();
    edgeDetectionImage();
    renderResults();
  }
}

function keyPressed() {
  if (key === "+" || key === "=") {
    k++;
    if (img && cvReady) {
      segmentImage();
      renderResults();
    }
  } else if (key === "-" && k > 2) {
    k--;
    if (img && cvReady) {
      segmentImage();
      renderResults();
    }
  }
}

function mousePressed() {
  // Overlay edge image on top of segmented image when mouse is pressed
  if (edgeImg) {
    overlay = true;
    renderResults();
  }
}

function mouseReleased() {
  // Remove overlay when mouse is released
  overlay = false;
  renderResults();
}
