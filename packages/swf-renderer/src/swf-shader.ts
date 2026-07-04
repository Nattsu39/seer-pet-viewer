import {
  Matrix,
  Shader,
  Texture,
  UniformGroup,
  compileHighShaderGlProgram,
  localUniformBitGl,
  roundPixelsBitGl,
  type GlProgram,
} from "pixi.js";

/** 递增以在热更新后强制重新编译 shader */
const SHADER_CACHE_VERSION = 13;
let shaderCacheVersion = -1;

/**
 * 与 pet_export.sample_bilinear_vec 一致：u*(w-1) 像素坐标 + 软件双线性。
 * 用 nearest + 四次采样，避免硬件对直通 alpha 图集分离插值 RGB/A 产生暗边。
 */
const swfAtlasTextureBitGl = {
  name: "swf-atlas-texture-bit",
  vertex: {
    header: /* glsl */ `
      uniform mat3 uTextureMatrix;
    `,
    main: /* glsl */ `
      uv = (uTextureMatrix * vec3(uv, 1.0)).xy;
    `,
  },
  fragment: {
    header: /* glsl */ `
      uniform sampler2D uTexture;
      uniform vec2 uAtlasSize;

      vec4 fetchAtlasTexel(vec2 pixel) {
        vec2 texelUv = (pixel + 0.5) / uAtlasSize;
        return texture(uTexture, texelUv);
      }

      vec4 sampleSwfAtlas(vec2 atlasUv) {
        if (atlasUv.x < 0.0 || atlasUv.x > 1.0 || atlasUv.y < 0.0 || atlasUv.y > 1.0) {
          return vec4(0.0);
        }
        float w = uAtlasSize.x;
        float h = uAtlasSize.y;
        float x = atlasUv.x * (w - 1.0);
        float y = atlasUv.y * (h - 1.0);
        float x0 = floor(x);
        float y0 = floor(y);
        float x1 = min(x0 + 1.0, w - 1.0);
        float y1 = min(y0 + 1.0, h - 1.0);
        float tx = x - x0;
        float ty = y - y0;
        vec4 c00 = fetchAtlasTexel(vec2(x0, y0));
        vec4 c10 = fetchAtlasTexel(vec2(x1, y0));
        vec4 c01 = fetchAtlasTexel(vec2(x0, y1));
        vec4 c11 = fetchAtlasTexel(vec2(x1, y1));
        vec4 c0 = mix(c00, c10, tx);
        vec4 c1 = mix(c01, c11, tx);
        return mix(c0, c1, ty);
      }
    `,
    main: /* glsl */ `
      outColor = sampleSwfAtlas(vUV);
    `,
  },
};

const swfColorBitGl = {
  name: "swf-color-bit",
  vertex: {
    header: /* glsl */ `
      in vec4 aMulColor;
      in vec4 aAddColor;
      out vec4 vMulColor;
      out vec4 vAddColor;
    `,
    start: /* glsl */ `
      vMulColor = aMulColor;
      vAddColor = aAddColor;
    `,
  },
  fragment: {
    header: /* glsl */ `
      in vec4 vMulColor;
      in vec4 vAddColor;
      uniform vec4 uTint;
    `,
    main: /* glsl */ `
      outColor = outColor * vMulColor * uTint;
      float swfA = outColor.a;
      outColor = outColor + step(0.01, swfA) * vAddColor;
    `,
  },
};

const swfGrabBitGl = {
  name: "swf-grab-bit",
  vertex: {
    header: /* glsl */ `
      in float aGrabMode;
      out vec2 vScreenUV;
      out float vGrabMode;
    `,
    start: /* glsl */ `
      vGrabMode = aGrabMode;
    `,
    end: /* glsl */ `
      vec2 ndc = gl_Position.xy / gl_Position.w;
      vScreenUV = ndc * 0.5 + 0.5;
      vScreenUV.y = 1.0 - vScreenUV.y;
    `,
  },
  fragment: {
    header: /* glsl */ `
      uniform sampler2D uGrabTexture;
      in vec2 vScreenUV;
      in float vGrabMode;
    `,
    main: /* glsl */ `
      vec4 grab = texture(uGrabTexture, vScreenUV);
      float srcA = outColor.a;
      if (vGrabMode == 1.0) {
        outColor = min(grab, outColor);
        outColor.a = srcA;
      } else if (vGrabMode == 2.0) {
        outColor = abs(grab - outColor);
        outColor.a = srcA;
      } else if (vGrabMode == 3.0) {
        outColor = vec4(1.0 - grab.rgb, srcA);
      } else if (vGrabMode == 4.0) {
        outColor = mix(2.0 * grab * outColor, 1.0 - 2.0 * (1.0 - grab) * (1.0 - outColor), step(0.5, grab));
        outColor.a = srcA;
      } else if (vGrabMode == 5.0) {
        outColor = mix(2.0 * grab * outColor, 1.0 - (1.0 - grab) * (1.0 - 2.0 * (outColor - 0.5)), step(0.5, outColor));
        outColor.a = srcA;
      }
    `,
  },
};

const swfMaskBitGl = {
  name: "swf-mask-bit",
  vertex: {
    header: /* glsl */ `
      in vec4 aMulColor;
      out float vMaskAlpha;
    `,
    start: /* glsl */ `
      vMaskAlpha = aMulColor.a;
    `,
  },
  fragment: {
    header: /* glsl */ `
      in float vMaskAlpha;
    `,
    main: /* glsl */ `
      if (outColor.a < 0.01) discard;
      outColor = vec4(outColor.a);
    `,
  },
};

let glProgramNormal: GlProgram | null = null;
let glProgramGrab: GlProgram | null = null;
let glProgramMask: GlProgram | null = null;

function invalidateShaderCacheIfNeeded(): void {
  if (shaderCacheVersion === SHADER_CACHE_VERSION) return;
  glProgramNormal = null;
  glProgramGrab = null;
  glProgramMask = null;
  shaderCacheVersion = SHADER_CACHE_VERSION;
}

function getGlProgram(grab: boolean, mask = false): GlProgram {
  invalidateShaderCacheIfNeeded();
  if (mask) {
    glProgramMask ??= compileHighShaderGlProgram({
      name: "swf-mask-shader-atlas",
      bits: [localUniformBitGl, swfAtlasTextureBitGl, swfMaskBitGl, roundPixelsBitGl],
    });
    return glProgramMask;
  }
  if (grab) {
    glProgramGrab ??= compileHighShaderGlProgram({
      name: "swf-grab-shader-atlas",
      bits: [
        localUniformBitGl,
        swfAtlasTextureBitGl,
        swfColorBitGl,
        swfGrabBitGl,
        roundPixelsBitGl,
      ],
    });
    return glProgramGrab;
  }
  glProgramNormal ??= compileHighShaderGlProgram({
    name: "swf-shader-atlas",
    bits: [localUniformBitGl, swfAtlasTextureBitGl, swfColorBitGl, roundPixelsBitGl],
  });
  return glProgramNormal;
}

export function createSwfShader(
  texture: Texture,
  grab: boolean,
  tint: [number, number, number, number],
  atlasWidth: number,
  atlasHeight: number,
  mask = false,
  grabSource: Texture["source"] | null = null,
): Shader {
  const swfUniforms = new UniformGroup({
    uTint: { value: new Float32Array(tint), type: "vec4<f32>" },
  });

  return new Shader({
    glProgram: getGlProgram(grab, mask),
    resources: {
      localUniforms: new UniformGroup({
        uTransformMatrix: { value: new Matrix(), type: "mat3x3<f32>" },
        uColor: { value: new Float32Array([1, 1, 1, 1]), type: "vec4<f32>" },
        uRound: { value: 0, type: "f32" },
      }),
      swfUniforms,
      textureUniforms: new UniformGroup({
        uTextureMatrix: { value: new Matrix(), type: "mat3x3<f32>" },
        uAtlasSize: {
          value: new Float32Array([atlasWidth, atlasHeight]),
          type: "vec2<f32>",
        },
      }),
      uTexture: texture.source,
      uSampler: texture.source.style,
      ...(grab
        ? {
            uGrabTexture: grabSource ?? Texture.EMPTY.source,
            uGrabSampler: (grabSource ?? Texture.EMPTY.source).style,
          }
        : {}),
    },
  });
}

function syncAtlasUniforms(
  shader: Shader,
  texture: Texture,
  tint: [number, number, number, number],
  atlasWidth: number,
  atlasHeight: number,
): void {
  const swfUniforms = shader.resources.swfUniforms as UniformGroup<{
    uTint: { value: Float32Array; type: "vec4<f32>" };
  }>;
  swfUniforms.uniforms.uTint.set(tint);
  swfUniforms.update();

  const textureUniforms = shader.resources.textureUniforms as UniformGroup<{
    uTextureMatrix: { value: Matrix; type: "mat3x3<f32>" };
    uAtlasSize: { value: Float32Array; type: "vec2<f32>" };
  }>;
  const mapCoord = texture.textureMatrix?.mapCoord;
  if (!mapCoord) {
    throw new Error("图集 textureMatrix.mapCoord 不可用");
  }
  textureUniforms.uniforms.uTextureMatrix.copyFrom(mapCoord);
  textureUniforms.uniforms.uAtlasSize.set([atlasWidth, atlasHeight]);
  textureUniforms.update();
}

function syncAtlasShaderResources(
  shader: Shader,
  texture: Texture,
  tint: [number, number, number, number],
  atlasWidth: number,
  atlasHeight: number,
): void {
  syncAtlasUniforms(shader, texture, tint, atlasWidth, atlasHeight);
  shader.resources.uTexture = texture.source;
  shader.resources.uSampler = texture.source.style;
}

export function updateSwfShaderResources(
  shader: Shader,
  texture: Texture,
  tint: [number, number, number, number],
  atlasWidth: number,
  atlasHeight: number,
  mask = false,
): void {
  if (mask) {
    const textureUniforms = shader.resources.textureUniforms as UniformGroup<{
      uTextureMatrix: { value: Matrix; type: "mat3x3<f32>" };
      uAtlasSize: { value: Float32Array; type: "vec2<f32>" };
    }>;
    textureUniforms.uniforms.uTextureMatrix.copyFrom(texture.textureMatrix.mapCoord);
    textureUniforms.uniforms.uAtlasSize.set([atlasWidth, atlasHeight]);
    textureUniforms.update();
    shader.resources.uTexture = texture.source;
    shader.resources.uSampler = texture.source.style;
    return;
  }

  if ("uGrabTexture" in shader.resources) {
    syncAtlasUniforms(shader, texture, tint, atlasWidth, atlasHeight);
    return;
  }

  syncAtlasShaderResources(shader, texture, tint, atlasWidth, atlasHeight);
}
