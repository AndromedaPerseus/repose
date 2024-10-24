import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSpring,
  Easing,
} from "react-native-reanimated";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FaceLandmarksCanvas } from "./FaceLandmarksCanvas";
import PhotosService from "../api/photos";
import { useFaceDetector } from "@infinitered/react-native-mlkit-face-detection";
import * as FileSystem from "expo-file-system";
import { debounce } from "lodash";
import { FeatureKey } from "../lib/faceControl";
import { SelfieSegmentationDetector } from "../api/segmentation";
import { SegmentationCanvas } from "./SegmentationCanvas";

// Animation constants
const LOADING_ANIMATION = {
  IMAGE_OPACITY_DURATION_MS: 200,
  CANVAS_OPACITY_DURATION_MS: 2000,
  PULSE_DURATION_MS: 1000,
  PULSE_OPACITY_TO: 1,
  PULSE_OPACITY_FROM: 1,
  IMAGE_BLUR: 0,
};

const IMAGE_TRANSITION = {
  duration: 150,
  effect: "cross-dissolve",
} as const;

const DEFAULT_IMAGE_SIZE = {
  width: 1024,
  height: 1024,
};

const DETECTOR_OPTIONS = {
  performanceMode: "fast",
  landmarkMode: false,
  contourMode: true,
} as const;

export type LandmarkLocation = [number, number]; // [x, y] coordinates

export interface FaceLandmarkResult {
  faceOval: LandmarkLocation[];
  leftEyebrow: LandmarkLocation[];
  rightEyebrow: LandmarkLocation[];
  leftEye: LandmarkLocation[];
  rightEye: LandmarkLocation[];
  lips: LandmarkLocation[];
  upperLips: LandmarkLocation[];
  lowerLips: LandmarkLocation[];
}

interface ImageContainerProps {
  loading?: boolean;
  imageUrl?: string;
  originalImageUrl?: string;
  detectFace?: boolean;
  debug?: boolean;
  selectedControl?: FeatureKey;
}

const calculateImageDimensions = (
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
  contentFit: "cover" | "contain" = "cover"
) => {
  const imageAspectRatio = imageWidth / imageHeight;
  const containerAspectRatio = containerWidth / containerHeight;

  let width,
    height,
    x = 0,
    y = 0;

  if (contentFit === "cover") {
    if (containerAspectRatio > imageAspectRatio) {
      width = containerWidth;
      height = containerWidth / imageAspectRatio;
      y = (containerHeight - height) / 2;
    } else {
      height = containerHeight;
      width = containerHeight * imageAspectRatio;
      x = (containerWidth - width) / 2;
    }
  } else {
    // contain
    if (containerAspectRatio > imageAspectRatio) {
      height = containerHeight;
      width = containerHeight * imageAspectRatio;
      x = (containerWidth - width) / 2;
    } else {
      width = containerWidth;
      height = containerWidth / imageAspectRatio;
      y = (containerHeight - height) / 2;
    }
  }

  return { width, height, x, y };
};

export const ImageContainer = ({
  loading = false,
  imageUrl,
  originalImageUrl,
  detectFace = false,
  debug = false,
  selectedControl,
}: ImageContainerProps) => {
  loading = true;
  const [lastLoadedImage, setLastLoadedImage] = useState<string | undefined>(
    undefined
  );
  const [landmarks, setLandmarks] = useState<FaceLandmarkResult | null>(null);
  const [segmentationPath, setSegmentationPath] = useState<
    [number, number][] | null
  >([]);
  const [imageLayout, setImageLayout] = useState<{
    width: number;
    height: number;
    x: number;
    y: number;
  } | null>(null);
  const [originalImageSize, setOriginalImageSize] =
    useState(DEFAULT_IMAGE_SIZE);
  const faceDetector = useFaceDetector();

  const faceDetectorOptions = useMemo(() => DETECTOR_OPTIONS, []);

  const downloadAndDetectFace = useCallback(async () => {
    if (!detectFace || !imageUrl) return;

    setLandmarks(null);

    try {
      const localUri = `${FileSystem.cacheDirectory}${imageUrl.split("/").pop()}`;
      const fileInfo = await FileSystem.getInfoAsync(localUri);

      if (!fileInfo.exists) {
        await FileSystem.downloadAsync(imageUrl, localUri);
      }

      await faceDetector.initialize(faceDetectorOptions);
      const result = await faceDetector.detectFaces(localUri);

      if (!result || result.error || !result.faces.length) {
        return;
      }

      const face = result.faces[0];
      const getContourPoints = (type: string): LandmarkLocation[] => {
        const contour = face.contours?.find((c) => c.type === type);
        return contour?.points?.map((p) => [p.x, p.y]) ?? [];
      };

      const landmarks = {
        faceOval: getContourPoints("Face"),
        leftEyebrow: [
          ...getContourPoints("LeftEyebrowTop"),
          ...getContourPoints("LeftEyebrowBottom").reverse(),
        ],
        rightEyebrow: [
          ...getContourPoints("RightEyebrowTop"),
          ...getContourPoints("RightEyebrowBottom").reverse(),
        ],
        leftEye: getContourPoints("LeftEye"),
        rightEye: getContourPoints("RightEye"),
        lips: [
          ...getContourPoints("UpperLipTop"),
          ...getContourPoints("UpperLipBottom"),
          ...getContourPoints("LowerLipTop"),
          ...getContourPoints("LowerLipBottom"),
        ],
        upperLips: [
          ...getContourPoints("UpperLipTop"),
          ...getContourPoints("UpperLipBottom").reverse(),
        ],
        lowerLips: [
          ...getContourPoints("LowerLipTop"),
          ...getContourPoints("LowerLipBottom").reverse(),
        ],
      };

      setLandmarks(landmarks);
      FileSystem.deleteAsync(localUri).catch(console.error);
    } catch (error) {
      console.error("Error detecting face landmarks:", error);
      setLandmarks(null);
    }
  }, [imageUrl, detectFace, faceDetector, faceDetectorOptions]);

  const detectBackground = useCallback(async () => {
    if (!detectFace || !imageUrl) {
      setSegmentationPath(null);
      return;
    }

    try {
      const segmenter = SelfieSegmentationDetector.getInstance();
      await segmenter.initialize();
      const segmentationPath = await segmenter.segmentImage(imageUrl);
      setSegmentationPath(segmentationPath);
    } catch (error) {
      console.error("Error detecting background:", error);
      setSegmentationPath(null);
    }
  }, [imageUrl, detectFace, originalImageSize.width, originalImageSize.height]);

  const debouncedDetectFace = useMemo(
    () =>
      debounce(
        async () => {
          await Promise.all([downloadAndDetectFace(), detectBackground()]);
        },
        75,
        {
          leading: false,
          trailing: true,
        }
      ),
    [downloadAndDetectFace]
  );

  useEffect(() => {
    if (imageUrl) {
      setLandmarks(null);
      debouncedDetectFace();
      return () => {
        debouncedDetectFace.cancel();
      };
    }
  }, [imageUrl]);

  const handleImageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height, x, y } = event.nativeEvent.layout;
    setImageLayout({ width, height, x, y });
  }, []);

  const imageDimensions = useMemo(() => {
    return imageLayout
      ? calculateImageDimensions(
          imageLayout.width,
          imageLayout.height,
          originalImageSize.width,
          originalImageSize.height,
          "cover"
        )
      : null;
  }, [imageLayout, originalImageSize]);

  useEffect(() => {
    if (imageUrl) {
      PhotosService.getImageDimensions(imageUrl)
        .then((dimensions) => {
          setOriginalImageSize(dimensions);
        })
        .catch((error) => {
          console.error("Error getting image dimensions:", error);
        });
    }
  }, [imageUrl]);

  const canvasOpacity = useSharedValue(0);
  const loadingOpacity = useSharedValue(1);

  useEffect(() => {
    canvasOpacity.value = withSpring(loading || debug ? 1 : 0, {
      duration: LOADING_ANIMATION.CANVAS_OPACITY_DURATION_MS,
    });

    if (loading) {
      loadingOpacity.value = LOADING_ANIMATION.PULSE_OPACITY_FROM;
      loadingOpacity.value = withRepeat(
        withTiming(LOADING_ANIMATION.PULSE_OPACITY_TO, {
          duration: LOADING_ANIMATION.PULSE_DURATION_MS,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true
      );
    } else {
      loadingOpacity.value = withTiming(1, {
        duration: LOADING_ANIMATION.IMAGE_OPACITY_DURATION_MS,
      });
    }
  }, [loading, debug]);

  const imageAnimatedStyle = useAnimatedStyle(() => ({
    opacity: loadingOpacity.value,
  }));

  const canvasAnimatedStyle = useAnimatedStyle(() => ({
    opacity: canvasOpacity.value,
  }));

  return (
    <View style={[styles.fullSize]}>
      <Animated.View style={[styles.fullSize, imageAnimatedStyle]}>
        <Image
          source={{ uri: imageUrl }}
          cachePolicy={"memory-disk"}
          placeholder={{ uri: lastLoadedImage || originalImageUrl }}
          placeholderContentFit="cover"
          blurRadius={loading ? LOADING_ANIMATION.IMAGE_BLUR : 0}
          allowDownscaling={false}
          priority={"high"}
          style={styles.fullSize}
          transition={IMAGE_TRANSITION}
          contentFit="cover"
          onLoadStart={() => {}}
          onLoadEnd={() => {
            setLastLoadedImage(imageUrl);
          }}
          onLayout={handleImageLayout}
        />
      </Animated.View>
      {detectFace && imageLayout && imageDimensions && (
        <Animated.View style={[styles.canvasContainer, canvasAnimatedStyle]}>
          <FaceLandmarksCanvas
            debug={debug}
            landmarks={landmarks}
            imageDimensions={imageDimensions}
            featureFilter={selectedControl ? [selectedControl] : undefined}
            originalImageSize={originalImageSize}
          />

          <SegmentationCanvas
            path={segmentationPath ? segmentationPath : []}
            imageDimensions={imageDimensions}
            originalImageSize={originalImageSize}
            debug={debug}
          />
        </Animated.View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  fullSize: {
    width: "100%",
    height: "100%",
  },
  canvasContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
});
