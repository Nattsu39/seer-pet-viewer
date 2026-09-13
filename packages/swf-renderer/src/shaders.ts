import type { SwfBlendMode } from "@seer-pet-anim/swf-bundle";

export const SWF_VERTEX = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
in vec4 aMulColor;
in vec4 aAddColor;

out vec2 vUV;
out vec4 vMulColor;
out vec4 vAddColor;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  vUV = aUV;
  vMulColor = aMulColor;
  vAddColor = aAddColor;
  vec3 pos =
    uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
}
`;

export const SWF_FRAGMENT = /* glsl */ `
precision highp float;

in vec2 vUV;
in vec4 vMulColor;
in vec4 vAddColor;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uTint;

void main() {
  vec4 c = texture(uTexture, vUV) * vMulColor * uTint;
  float a = c.a;
  c = c + step(0.01, a) * vAddColor;
  c.rgb *= c.a;
  finalColor = c;
}
`;

export const SWF_GRAB_FRAGMENT = /* glsl */ `
precision highp float;

in vec2 vUV;
in vec4 vMulColor;
in vec4 vAddColor;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uGrabTexture;
uniform vec4 uTint;
uniform int uGrabMode;

vec4 swfDarken(vec4 ca, vec4 cb) {
  vec4 r = min(ca, cb);
  r.a = cb.a;
  return r;
}

vec4 swfDifference(vec4 ca, vec4 cb) {
  vec4 r = abs(ca - cb);
  r.a = cb.a;
  return r;
}

vec4 swfInvert(vec4 ca, vec4 cb) {
  vec4 r = 1.0 - ca;
  r.a = cb.a;
  return r;
}

vec4 swfOverlay(vec4 ca, vec4 cb) {
  vec4 r = mix(2.0 * ca * cb, 1.0 - 2.0 * (1.0 - ca) * (1.0 - cb), step(0.5, ca));
  r.a = cb.a;
  return r;
}

vec4 swfHardlight(vec4 ca, vec4 cb) {
  vec4 r = mix(2.0 * ca * cb, 1.0 - (1.0 - ca) * (1.0 - 2.0 * (cb - 0.5)), step(0.5, cb));
  r.a = cb.a;
  return r;
}

void main() {
  vec4 c = texture(uTexture, vUV) * vMulColor * uTint;
  float a = c.a;
  c = c + step(0.01, a) * vAddColor;
  vec4 grab = texture(uGrabTexture, vUV);
  if (uGrabMode == 1) c = swfDarken(grab, c);
  else if (uGrabMode == 2) c = swfDifference(grab, c);
  else if (uGrabMode == 3) c = swfInvert(grab, c);
  else if (uGrabMode == 4) c = swfOverlay(grab, c);
  else if (uGrabMode == 5) c = swfHardlight(grab, c);
  c.rgb *= c.a;
  finalColor = c;
}
`;

export const SWF_MASK_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uTexture;

void main() {
  vec4 c = texture(uTexture, vUV);
  if (c.a < 0.01) discard;
  finalColor = vec4(c.a);
}
`;

export function grabModeId(mode?: SwfBlendMode): number {
  switch (mode) {
    case "darken":
      return 1;
    case "difference":
      return 2;
    case "invert":
      return 3;
    case "overlay":
      return 4;
    case "hardlight":
      return 5;
    default:
      return 0;
  }
}
