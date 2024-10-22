import { loadTensorflowModel, TensorflowModel } from "react-native-fast-tflite";
import PhotosService from "../api/photos";
import * as jpeg from "jpeg-js";

const INPUT_SIZE = 192;
const NUM_LANDMARKS = 468;
const NUM_DIMS = 3;

type LandmarkLocation = [number, number]; // [x, y] coordinates

export interface FaceLandmarkResult {
  faceOval: LandmarkLocation[];
  leftEyebrow: LandmarkLocation[];
  rightEyebrow: LandmarkLocation[];
  leftEye: LandmarkLocation[];
  rightEye: LandmarkLocation[];
  leftIris: LandmarkLocation[];
  rightIris: LandmarkLocation[];
  lips: LandmarkLocation[];
  tesselation: LandmarkLocation[];
  upperLips: LandmarkLocation[];
  lowerLips: LandmarkLocation[];
}

const FaceLandmarkRegionToIndices = {
  FACE_OVAL: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
    378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
    162, 21, 54, 103, 67, 109,
  ],
  LEFT_EYEBROW: [336, 296, 334, 293, 300, 276, 283, 282, 295, 285],
  RIGHT_EYEBROW: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  LEFT_EYE: [
    362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384,
    398,
  ],
  RIGHT_EYE: [
    33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
  ],
  LEFT_IRIS: [468],
  RIGHT_IRIS: [473],
  LIPS: [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317,
    14, 87, 178, 88, 95, 185, 40, 39, 37, 0, 267, 269, 270, 409, 415, 310, 311,
    312, 13, 82, 81, 42, 183, 78,
  ],
  UPPER_LIPS: [
    185, 40, 39, 37, 0, 267, 269, 270, 409, 415, 310, 311, 312, 13, 82, 81, 42,
    183, 78,
  ],
  LOWER_LIPS: [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317,
    14, 87, 178, 88, 95,
  ],
  TESSELATION: [
    127, 34, 139, 127, 162, 21, 54, 103, 67, 109, 10, 338, 297, 332, 284, 251,
    389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176,
    149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  ],
} as const;

export class FaceLandmarkDetector {
  private static instance: FaceLandmarkDetector;
  private model: TensorflowModel | null;

  private constructor() {
    this.model = null;
  }

  public static getInstance(): FaceLandmarkDetector {
    if (!FaceLandmarkDetector.instance) {
      FaceLandmarkDetector.instance = new FaceLandmarkDetector();
    }
    return FaceLandmarkDetector.instance;
  }

  async initialize() {
    if (this.model) {
      return;
    }

    try {
      // https://mediapipe.page.link/facemesh-mc
      this.model = await loadTensorflowModel(
        require("../assets/face_landmark.tflite")
      );
      console.log("Face landmark model initialized");
    } catch (error) {
      console.error("Error initializing face landmark model:", error);
    }
  }

  async detectLandmarks(imageUri: string): Promise<FaceLandmarkResult> {
    if (!this.model) {
      throw new Error(
        "Face landmark model not initialized. Call initialize() first."
      );
    }

    try {
      const { width: originalWidth, height: originalHeight } =
        await PhotosService.getImageDimensions(imageUri);

      // Resize the image while maintaining aspect ratio
      const aspectRatio = originalWidth / originalHeight;
      let targetWidth, targetHeight;
      if (aspectRatio > 1) {
        targetWidth = INPUT_SIZE;
        targetHeight = Math.round(INPUT_SIZE / aspectRatio);
      } else {
        targetHeight = INPUT_SIZE;
        targetWidth = Math.round(INPUT_SIZE * aspectRatio);
      }

      const jpegImageData = await PhotosService.convertToJpeg(
        imageUri,
        targetWidth,
        targetHeight
      );
      const base64Data = jpegImageData.replace(/^data:image\/jpeg;base64,/, "");

      // Convert base64 to Uint8Array
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Decode JPEG data
      const rawImageData = jpeg.decode(bytes, { useTArray: true });

      // Resize the decoded image data to match the model's input size
      const resizedImageData = this.resizeImageData(
        rawImageData,
        INPUT_SIZE,
        INPUT_SIZE
      );

      // Prepare the input data - normalize to [0, 1]
      const inputData = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
      for (let i = 0; i < resizedImageData.length; i += 4) {
        const offset = (i / 4) * 3;
        inputData[offset] = resizedImageData[i] / 255.0; // R
        inputData[offset + 1] = resizedImageData[i + 1] / 255.0; // G
        inputData[offset + 2] = resizedImageData[i + 2] / 255.0; // B
      }

      // Run the model with raw data array
      const outputData = await this.model.run([inputData]);

      // Scale the landmark coordinates back to original image dimensions
      const result = this.interpretOutput(
        outputData[0],
        originalWidth,
        originalHeight
      );

      return result;
    } catch (error) {
      console.error("Error detecting face landmarks:", error);
      throw error;
    }
  }

  private resizeImageData(
    imageData: any,
    targetWidth: number,
    targetHeight: number
  ): Uint8Array {
    const resizedData = new Uint8Array(targetWidth * targetHeight * 4);
    const aspectRatio = imageData.width / imageData.height;
    let scaledWidth, scaledHeight;

    // Align this logic with the one in detectLandmarks
    if (aspectRatio > 1) {
      scaledWidth = targetWidth;
      scaledHeight = Math.round(targetWidth / aspectRatio);
    } else {
      scaledHeight = targetHeight;
      scaledWidth = Math.round(targetHeight * aspectRatio);
    }

    const offsetX = Math.floor((targetWidth - scaledWidth) / 2);
    const offsetY = Math.floor((targetHeight - scaledHeight) / 2);

    for (let y = 0; y < scaledHeight; y++) {
      for (let x = 0; x < scaledWidth; x++) {
        const sourceX = Math.floor((x * imageData.width) / scaledWidth);
        const sourceY = Math.floor((y * imageData.height) / scaledHeight);
        const sourceIndex = (sourceY * imageData.width + sourceX) * 4;
        const targetIndex = ((y + offsetY) * targetWidth + (x + offsetX)) * 4;

        if (
          sourceIndex >= 0 &&
          sourceIndex < imageData.data.length - 3 &&
          targetIndex >= 0 &&
          targetIndex < resizedData.length - 3
        ) {
          resizedData[targetIndex] = imageData.data[sourceIndex];
          resizedData[targetIndex + 1] = imageData.data[sourceIndex + 1];
          resizedData[targetIndex + 2] = imageData.data[sourceIndex + 2];
          resizedData[targetIndex + 3] = imageData.data[sourceIndex + 3];
        }
      }
    }

    return resizedData;
  }

  private interpretOutput(
    outputData: any,
    imageWidth: number,
    imageHeight: number
  ): FaceLandmarkResult {
    if (outputData.length < NUM_LANDMARKS * NUM_DIMS) {
      throw new Error("Incompatible model output");
    }

    // The model outputs coordinates in range [0,192] (input image size)
    // First normalize to [0,1], then scale to target dimensions
    const allLandmarks: LandmarkLocation[] = [];
    for (let i = 0; i < NUM_LANDMARKS; i++) {
      const x = (outputData[i * NUM_DIMS] / INPUT_SIZE) * imageWidth;
      const y = (outputData[i * NUM_DIMS + 1] / INPUT_SIZE) * imageHeight;

      allLandmarks.push([x, y]);
    }

    // Then map each region to its actual points
    return {
      faceOval: FaceLandmarkRegionToIndices.FACE_OVAL.map(
        (i) => allLandmarks[i]
      ),
      leftEyebrow: FaceLandmarkRegionToIndices.LEFT_EYEBROW.map(
        (i) => allLandmarks[i]
      ),
      rightEyebrow: FaceLandmarkRegionToIndices.RIGHT_EYEBROW.map(
        (i) => allLandmarks[i]
      ),
      leftEye: FaceLandmarkRegionToIndices.LEFT_EYE.map((i) => allLandmarks[i]),
      rightEye: FaceLandmarkRegionToIndices.RIGHT_EYE.map(
        (i) => allLandmarks[i]
      ),
      leftIris: FaceLandmarkRegionToIndices.LEFT_IRIS.map(
        (i) => allLandmarks[i]
      ),
      rightIris: FaceLandmarkRegionToIndices.RIGHT_IRIS.map(
        (i) => allLandmarks[i]
      ),
      lips: FaceLandmarkRegionToIndices.LIPS.map((i) => allLandmarks[i]),
      tesselation: FaceLandmarkRegionToIndices.TESSELATION.map(
        (i) => allLandmarks[i]
      ),
      upperLips: FaceLandmarkRegionToIndices.UPPER_LIPS.map(
        (i) => allLandmarks[i]
      ),
      lowerLips: FaceLandmarkRegionToIndices.LOWER_LIPS.map(
        (i) => allLandmarks[i]
      ),
    };
  }
}
