import { Text, View, Pressable, StyleSheet } from "react-native";
import { photos } from "../../../data";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SymbolView } from "expo-symbols";
import { StatusBar } from "expo-status-bar";
import Carousel, { ICarouselInstance } from "react-native-reanimated-carousel";
import { useState, useRef, useEffect, useCallback } from "react";
import { CarouselSlider } from "./CarouselSlider";
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PinchGestureHandler,
  TapGestureHandler,
  GestureEvent,
  TapGestureHandlerEventPayload,
  RotationGestureHandler,
  PinchGestureHandlerEventPayload,
  PanGestureHandlerEventPayload,
  RotationGestureHandlerEventPayload,
} from "react-native-gesture-handler";
import ReplicateService from "../../api/replicate";

enum GestureDirection {
  Normal = "normal",
  Inverted = "inverted",
}

interface Photo {
  id: number;
  url: string;
}

interface FaceControl {
  key: string;
  icon: string;
  label: string;
  values: {
    key: keyof FaceValues;
    label: string;
    min: number;
    max: number;
    gesture: "panX" | "panY" | "pinch" | "tapX" | "tapY" | "rotation";
    direction?: GestureDirection;
  }[];
}

type FaceValues = {
  eyebrow: number;
  pitch: number;
  yaw: number;
  roll: number;
  blink: number;
  wink: number;
  pupilX: number;
  pupilY: number;
  smile: number;
};

const FACE_CONTROLS: FaceControl[] = [
  {
    key: "face",
    icon: "face.smiling.inverse",
    label: "FACE",
    values: [
      { key: "pitch", label: "PITCH", min: -20, max: 20, gesture: "panY" },
      { key: "yaw", label: "YAW", min: -20, max: 20, gesture: "panX" },
      { key: "roll", label: "ROLL", min: -20, max: 20, gesture: "rotation" },
    ],
  },
  {
    key: "mouth",
    icon: "mouth.fill",
    label: "MOUTH",
    values: [
      { key: "smile", label: "SMILE", min: -0.3, max: 1.3, gesture: "pinch" },
    ],
  },
  {
    key: "eyes",
    icon: "eye.fill",
    label: "EYES",
    values: [
      {
        key: "blink",
        label: "EYELID APERTURE",
        min: -20,
        max: 5,
        gesture: "pinch",
      },
      {
        key: "pupilX",
        label: "HORIZONTAL",
        min: -15,
        max: 15,
        gesture: "panX",
        direction: GestureDirection.Inverted,
      },
      {
        key: "pupilY",
        label: "VERTICAL",
        min: -15,
        max: 15,
        gesture: "panY",
        direction: GestureDirection.Inverted,
      },
    ],
  },
  {
    key: "eyebrows",
    icon: "eyebrow",
    label: "EYEBROWS",
    values: [
      {
        key: "eyebrow",
        label: "Height",
        min: -10,
        max: 15,
        gesture: "panY",
        direction: GestureDirection.Inverted,
      },
    ],
  },
];

export default function EditScreen() {
  const [faceValues, setFaceValues] = useState<FaceValues>({
    pitch: 0,
    yaw: 0,
    eyebrow: 0,
    roll: 0,
    blink: 0,
    wink: 0,
    pupilX: 0,
    pupilY: 0,
    smile: 0,
  });
  const [loading, setLoading] = useState(false);
  const [selectedControl, setSelectedControl] = useState(FACE_CONTROLS[0]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [originalImageUrl, setOriginalImageUrl] = useState<
    string | undefined
  >();
  const [editedImageUrl, setEditedImageUrl] = useState<string | undefined>();

  useEffect(() => {
    const photo = photos.find((p) => p.id === Number.parseInt(id));
    if (photo) {
      setOriginalImageUrl(photo.url);
      setEditedImageUrl(photo.url);
    }
  }, [id]);

  const router = useRouter();

  const runEditor = async (values: FaceValues) => {
    if (originalImageUrl) {
      setLoading(true);
      const updatedImageUrl = await ReplicateService.runExpressionEditor({
        image: originalImageUrl,
        ...values,
      });
      setEditedImageUrl(updatedImageUrl);
      setLoading(false);
      setFaceValues(values);
    }
  };

  if (!originalImageUrl) {
    return <Text>Photo not found</Text>;
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} />
      <TopBar onBack={() => router.back()} />
      <AdjustBar />
      <Text>Brightness</Text>
      {editedImageUrl && (
        <ImageContainer
          loading={loading}
          faceValues={faceValues}
          handleFaceValuesChange={runEditor}
          selectedControl={selectedControl}
          imageUrl={editedImageUrl}
        />
      )}
      <FaceControlsComponent
        faceValues={faceValues}
        onFaceValuesChange={runEditor}
        selectedControl={selectedControl}
        setSelectedControl={setSelectedControl}
      />
    </View>
  );
}

interface TopBarProps {
  onBack: () => void;
}

const TopBar = ({ onBack }: TopBarProps) => (
  <View style={styles.topBar}>
    <Pressable style={styles.topBarButton} onPress={onBack}>
      <Text style={styles.topBarButtonText}>Cancel</Text>
    </Pressable>
    <Pressable style={styles.topBarButtonRed} onPress={onBack}>
      <Text style={styles.topBarButtonTextWhite}>Revert</Text>
    </Pressable>
  </View>
);

const AdjustBar = () => (
  <View style={styles.adjustBar}>
    <View style={styles.rowWithGap}>
      <SymbolView
        name="arrow.uturn.backward.circle"
        weight="regular"
        style={styles.adjustSymbol}
        resizeMode="scaleAspectFit"
      />
      <SymbolView
        name="arrow.uturn.forward.circle"
        weight="regular"
        style={styles.adjustSymbol}
        resizeMode="scaleAspectFit"
      />
    </View>
    <Text style={styles.adjustText}>ADJUST</Text>
    <View style={styles.rowWithGap}>
      <SymbolView
        name="pencil.tip.crop.circle"
        weight="medium"
        style={styles.adjustSymbolActive}
        resizeMode="scaleAspectFit"
      />
      <SymbolView
        name="ellipsis.circle"
        weight="medium"
        style={styles.adjustSymbolActive}
        resizeMode="scaleAspectFit"
      />
    </View>
  </View>
);

interface ImageContainerProps {
  loading: boolean;
  faceValues: FaceValues;
  handleFaceValuesChange: (values: FaceValues) => void;
  selectedControl: FaceControl;
  imageUrl: string;
}

const ImageContainer = ({
  loading,
  faceValues,
  handleFaceValuesChange,
  selectedControl,
  imageUrl,
}: ImageContainerProps) => {
  const pulseAnimation = useSharedValue(1);
  const [gestureValues, setGestureValues] = useState<FaceValues>(faceValues);
  const [imageDimensions, setImageDimensions] = useState({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    pulseAnimation.value = loading
      ? withRepeat(withTiming(0.5, { duration: 750 }), -1, true)
      : withTiming(1, { duration: 250 });
  }, [loading, pulseAnimation]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pulseAnimation.value,
  }));

  const handleGesture = (gesture: string, value: number) => {
    const control = selectedControl.values.find((v) => v.gesture === gesture);
    if (control) {
      const range = control.max - control.min;
      const normalizedValue = isNaN(value) ? 0 : (value / 100) * range * 2;

      setGestureValues((prevValues) => {
        const newValue = Math.min(
          Math.max(prevValues[control.key] + normalizedValue, control.min),
          control.max
        );
        return { ...prevValues, [control.key]: newValue };
      });
    }
  };

  const handlePanGesture = (
    event: GestureEvent<PanGestureHandlerEventPayload>
  ) => {
    const { translationX, translationY } = event.nativeEvent;
    const { width: imageWidth, height: imageHeight } = imageDimensions;

    const normalizedX = (translationX / imageWidth) * 1000;
    const normalizedY = (translationY / imageHeight) * 1000;

    selectedControl.values.forEach((control) => {
      if (control.gesture === "panX") {
        const value =
          control.direction === GestureDirection.Inverted
            ? -normalizedX
            : normalizedX;
        handleGesture("panX", value);
      } else if (control.gesture === "panY") {
        const value =
          control.direction === GestureDirection.Inverted
            ? -normalizedY
            : normalizedY;
        handleGesture("panY", value);
      }
    });
  };

  const handlePinchGesture = (
    event: GestureEvent<PinchGestureHandlerEventPayload>
  ) => {
    const { scale } = event.nativeEvent;
    handleGesture("pinch", (scale - 1) * 1000);
  };

  const handleRotationGesture = (
    event: GestureEvent<RotationGestureHandlerEventPayload>
  ) => {
    const { rotation } = event.nativeEvent;
    const { width: imageWidth, height: imageHeight } = imageDimensions;
    const diagonal = Math.sqrt(imageWidth ** 2 + imageHeight ** 2);
    const normalizedRotation =
      (rotation / (Math.PI * 2)) * (diagonal / 2) * 1000;

    selectedControl.values.forEach((control) => {
      if (control.gesture === "rotation") {
        const value =
          control.direction === GestureDirection.Inverted
            ? -normalizedRotation
            : normalizedRotation;
        handleGesture("rotation", value);
      }
    });
  };

  const handleTapGesture = (
    event: GestureEvent<TapGestureHandlerEventPayload>
  ) => {
    const { x, y } = event.nativeEvent;
    const { width: imageWidth, height: imageHeight } = imageDimensions;
    const tapXValue = x < imageWidth / 2 ? 10 : -10;
    handleGesture("tapX", tapXValue);
    const tapYValue = y < imageHeight / 2 ? 10 : -10;
    handleGesture("tapY", tapYValue);
  };

  useEffect(() => {
    handleFaceValuesChange(gestureValues);
  }, [gestureValues]);

  const rotationRef = useRef(null);
  const tapRef = useRef(null);

  return (
    <GestureHandlerRootView style={styles.imageContainer}>
      <PanGestureHandler
        onGestureEvent={loading ? undefined : handlePanGesture}
      >
        <PinchGestureHandler
          onGestureEvent={loading ? undefined : handlePinchGesture}
          simultaneousHandlers={[rotationRef, tapRef]}
        >
          <RotationGestureHandler
            onGestureEvent={loading ? undefined : handleRotationGesture}
            simultaneousHandlers={[tapRef]}
            ref={rotationRef}
          >
            <TapGestureHandler
              onGestureEvent={loading ? undefined : handleTapGesture}
              ref={tapRef}
            >
              <Animated.View style={[styles.fullSize, animatedStyle]}>
                <Animated.Image
                  source={{ uri: imageUrl }}
                  style={styles.fullSize}
                  resizeMode="contain"
                  onLayout={(event) => {
                    const { width, height } = event.nativeEvent.layout;
                    setImageDimensions({ width, height });
                  }}
                />
              </Animated.View>
            </TapGestureHandler>
          </RotationGestureHandler>
        </PinchGestureHandler>
      </PanGestureHandler>
    </GestureHandlerRootView>
  );
};

interface FaceControlsComponentProps {
  faceValues: FaceValues;
  onFaceValuesChange: (values: FaceValues) => void;
  selectedControl: FaceControl;
  setSelectedControl: React.Dispatch<React.SetStateAction<FaceControl>>;
}

const FaceControlsComponent = ({
  faceValues,
  onFaceValuesChange,
  selectedControl,
  setSelectedControl,
}: FaceControlsComponentProps) => {
  const carouselRef = useRef<ICarouselInstance>(null);
  const [showSliders, setShowSliders] = useState(false);
  const [previousSelectedControl, setPreviousSelectedControl] =
    useState<FaceControl | null>(null);

  const scrollToIndex = (index: number) => {
    carouselRef.current?.scrollTo({ index, animated: true });
    if (selectedControl.key === FACE_CONTROLS[index].key) {
      setShowSliders(!showSliders);
    }
    setPreviousSelectedControl(selectedControl);
    setSelectedControl(FACE_CONTROLS[index]);
  };

  const handleValueChange = (key: keyof FaceValues, value: number) => {
    onFaceValuesChange({ ...faceValues, [key]: value });
  };

  return (
    <View style={styles.bottomPager}>
      <Text style={styles.selectedLabel}>{selectedControl.label}</Text>
      <Carousel
        ref={carouselRef}
        style={styles.carousel}
        width={100}
        height={60}
        data={FACE_CONTROLS}
        defaultIndex={0}
        loop={false}
        onSnapToItem={(index) => scrollToIndex(index)}
        renderItem={({ item, animationValue, index }) => (
          <CarouselItemComponent
            animationValue={animationValue}
            icon={item.icon}
            onPress={() => scrollToIndex(index)}
          />
        )}
      />
      {showSliders && (
        <View style={styles.slidersContainer}>
          {selectedControl.values.map((value) => (
            <View key={value.label} style={styles.sliderContainer}>
              <Text style={styles.sliderLabel}>{value.label}</Text>
              <CarouselSlider
                key={value.label}
                min={value.min}
                max={value.max}
                value={faceValues[value.key]}
                onValueChange={(val) => handleValueChange(value.key, val)}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

interface CarouselItemProps {
  animationValue: Animated.SharedValue<number>;
  icon: string;
  onPress: () => void;
}

const CarouselItemComponent = ({
  animationValue,
  icon,
  onPress,
}: CarouselItemProps) => {
  const containerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      animationValue.value,
      [-1, 0, 1],
      [0.4, 1, 0.4],
      Extrapolation.CLAMP
    );
    return { opacity };
  }, [animationValue]);

  return (
    <Pressable onPress={onPress}>
      <Animated.View
        style={[
          { alignItems: "center", justifyContent: "center" },
          containerStyle,
        ]}
      >
        <View style={styles.facePartIconContainer}>
          <SymbolView
            name={icon as any}
            weight="regular"
            style={styles.facePartIcon}
            resizeMode="scaleAspectFit"
          />
        </View>
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  slidersContainer: {
    flex: 1,
    gap: 10,
    flexDirection: "column",
    alignItems: "center",
  },
  sliderContainer: {
    flex: 1,
    gap: 2,
    flexDirection: "column",
    alignItems: "center",
  },
  facePartIconContainer: {
    borderRadius: 50,
    padding: 10,
    borderWidth: 2,
    borderColor: "#46454A",
  },
  sliderLabel: {
    color: "#8E8D93",
    fontWeight: "500",
    fontSize: 12,
  },
  sliderValue: {
    color: "#8E8D93",
  },
  adjustBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  adjustSymbol: {
    height: 24,
    width: 24,
    tintColor: "#46454A",
  },
  adjustSymbolActive: {
    height: 24,
    width: 24,
    tintColor: "#8E8D93",
  },
  facePartIcon: {
    height: 32,
    width: 32,
    tintColor: "#8E8D93",
  },
  adjustText: {
    color: "#8E8D93",
    fontWeight: "500",
    fontSize: 14,
  },
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  imageContainer: {
    flex: 1,
  },
  topBarButton: {
    backgroundColor: "#8E8D93",
    borderRadius: 50,
    padding: 7,
    paddingHorizontal: 12,
  },
  topBarButtonRed: {
    backgroundColor: "red",
    borderRadius: 50,
    padding: 7,
    paddingHorizontal: 12,
  },
  topBarButtonTextWhite: {
    fontWeight: "700",
    color: "#FFF",
  },
  rowWithGap: {
    flexDirection: "row",
    gap: 15,
  },
  topBarButtonText: {
    fontWeight: "700",
  },
  symbol: {
    height: 28,
    width: 28,
  },
  photoInfo: {
    flexDirection: "column",
    gap: 3,
  },
  topSymbol: {
    height: 15,
    width: 15,
  },
  topButton: {
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    borderRadius: 50,
    padding: 6,
  },
  topButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 7,
  },
  closeButton: {
    position: "absolute",
    top: 40,
    left: 20,
    zIndex: 1,
    padding: 10,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 5,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 15,
    width: "100%",
    zIndex: 1,
    paddingHorizontal: 40,
  },
  titleText: {
    color: "#000",
    fontWeight: "bold",
    fontSize: 20,
  },
  subheadingText: {
    color: "rgba(0, 0, 0, 0.5)",
    fontWeight: "light",
    fontSize: 12,
  },
  carousel: {
    width: "100%",
    marginVertical: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  fullSize: {
    width: "100%",
    height: "100%",
  },
  iconButton: {
    marginHorizontal: 10,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    borderRadius: 25,
    padding: 10,
  },
  selectedLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "thin",
    textAlign: "center",
    margin: 10,
  },
  bottomPager: {
    flex: 1,
    marginTop: 20,
    marginBottom: 50,
  },
});
