// CinematicVisualClip — renders a static image in 3D using @remotion/three.
//
// The image is mapped onto a plane whose vertices are displaced by a depth map.
// A PerspectiveCamera is animated per frame according to the selected preset,
// producing parallax, dolly, crane, orbit, and handheld effects.
//
// IMPORTANT: @remotion/three's <ThreeCanvas> cannot contain Remotion <Sequence>
// components. This component is a standalone AbsoluteFill-mounted ThreeCanvas,
// not nested inside the parent Sequence tree.
//
// Since @remotion/three v4 uses @react-three/fiber which requires React 19's
// `use` hook, and this project pins React 18, we use ThreeCanvas with a
// children-as-function render prop pattern. The function receives the R3F
// context { scene, camera, gl } and imperatively builds the scene.

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, continueRender, delayRender } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { CompositionVisualClipProps } from "./composition-props";
import { cameraStateAtFrame, depthDisplacementScale } from "./cinematic-camera";

export function CinematicVisualClip(props: CompositionVisualClipProps): React.ReactElement {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const config = props.cinematic!;

  const camera = cameraStateAtFrame(frame, durationInFrames, config.preset, config);
  const displacement = depthDisplacementScale(frame, durationInFrames, config);

  // Use a ref to track whether the scene has been built
  const sceneBuilt = React.useRef(false);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <ThreeCanvas
        width={width}
        height={height}
        camera={{ position: camera.position, fov: camera.fov, aspect: width / height }}
        style={{ width: "100%", height: "100%" }}
      >
        <DepthDisplacedImage
          imageSrc={props.src}
          depthMapSrc={config.depthMapSrc}
          displacement={displacement}
          cameraPosition={camera.position}
          cameraLookAt={camera.lookAt}
          aspectRatio={width / height}
          sceneBuiltRef={sceneBuilt}
        />
      </ThreeCanvas>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Imperative scene builder component (renders nothing visible — just builds the scene)
// ---------------------------------------------------------------------------

interface DepthDisplacedImageProps {
  imageSrc: string;
  depthMapSrc: string;
  displacement: number;
  cameraPosition: [number, number, number];
  cameraLookAt: [number, number, number];
  aspectRatio: number;
  sceneBuiltRef: React.MutableRefObject<boolean>;
}

/**
 * This component uses R3F's useThree and useLoader hooks (available via
 * @react-three/fiber v8 which is compatible with React 18). It builds the
 * depth-displaced plane and updates the camera position each frame.
 */
function DepthDisplacedImage(props: DepthDisplacedImageProps): React.ReactElement {
  const { scene, camera } = useThree();
  const [texturesLoaded, setTexturesLoaded] = React.useState(false);
  const [handle] = React.useState(() => delayRender("Loading textures for cinematic clip"));

  // Load textures
  const imageTexture = React.useMemo(() => {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(props.imageSrc, () => {
      setTexturesLoaded(true);
      continueRender(handle);
    });
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.imageSrc]);

  const depthTexture = React.useMemo(() => {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(props.depthMapSrc, () => {
      setTexturesLoaded(true);
      continueRender(handle);
    });
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.depthMapSrc]);

  // Build or update the scene
  React.useEffect(() => {
    if (!texturesLoaded) return;

    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    perspectiveCamera.position.set(...props.cameraPosition);
    perspectiveCamera.lookAt(new THREE.Vector3(...props.cameraLookAt));
    perspectiveCamera.updateProjectionMatrix();

    // Check if mesh already exists in the scene
    const existingMesh = scene.getObjectByProperty("type", "Mesh") as THREE.Mesh | undefined;

    if (!existingMesh) {
      // Create the depth-displaced plane
      const planeWidth = 4 * props.aspectRatio;
      const planeHeight = 4;
      const segments = 256;

      const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, segments, segments);

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uImage: { value: imageTexture },
          uDepth: { value: depthTexture },
          uDisplacement: { value: props.displacement },
        },
        vertexShader: /* glsl */ `
          uniform sampler2D uDepth;
          uniform float uDisplacement;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            float depth = texture2D(uDepth, uv).r;
            vec3 displacedPosition = position;
            displacedPosition.z += depth * uDisplacement;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uImage;
          varying vec2 vUv;
          void main() {
            gl_FragColor = texture2D(uImage, vUv);
          }
        `,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
    } else {
      // Update displacement uniform on existing mesh
      const material = existingMesh.material as THREE.ShaderMaterial;
      if (material.uniforms?.uDisplacement) {
        material.uniforms.uDisplacement.value = props.displacement;
      }
    }
  }, [scene, camera, texturesLoaded, props.displacement, props.cameraPosition,
      props.cameraLookAt, props.aspectRatio, imageTexture, depthTexture]);

  return <></>;
}
