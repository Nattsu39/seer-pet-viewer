import {
  Matrix,
  Shader,
  Texture,
  UniformGroup,
  GlProgram,
  compileHighShaderGl,
  fragmentGlTemplate,
  globalUniformsBitGl,
  localUniformBitGl,
  roundPixelsBitGl,
  vertexGlTemplate,
  type HighShaderBit,
} from "pixi.js";

/** 递增以在热更新后强制重新编译 shader */
const SHADER_CACHE_VERSION = 17;
let shaderCacheVersion = -1;

/** 超过此边长的图集在移动端使用 mediump 路径，避免 highp 片元运算加剧 OOM */
export const SWF_HIGH_PRECISION_ATLAS_MAX_SIDE = 2048;

export function useHighPrecisionAtlasSampling(
  atlasWidth: number,
  atlasHeight: number,
): boolean {
  return (
    Math.max(atlasWidth, atlasHeight) <= SWF_HIGH_PRECISION_ATLAS_MAX_SIDE
  );
}

/**
 * 与 pet_export.sample_bilinear_vec 一致：u*(w-1) 像素坐标 + 软件双线性。
 * 用 nearest + 四次采样，避免硬件对直通 alpha 图集分离插值 RGB/A 产生暗边。
 * 大图集（>2048）走 legacy + mediump，小图集走 highp + vSwfAtlasUV。
 */
const swfAtlasTextureBitGlHigh = {
  name: "swf-atlas-texture-bit-high",
  vertex: {
    header: /* glsl */ `
      uniform mat3 uTextureMatrix;
      out highp vec2 vSwfAtlasUV;
    `,
    main: /* glsl */ `
      uv = (uTextureMatrix * vec3(uv, 1.0)).xy;
      vSwfAtlasUV = uv;
    `,
  },
  fragment: {
    header: /* glsl */ `
      in highp vec2 vSwfAtlasUV;
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
        vec2 maxIdx = uAtlasSize - 1.0;
        vec2 p = atlasUv * maxIdx;
        vec2 i0 = floor(p);
        vec2 i1 = min(i0 + 1.0, maxIdx);
        vec2 f = p - i0;
        vec4 c00 = fetchAtlasTexel(i0);
        vec4 c10 = fetchAtlasTexel(vec2(i1.x, i0.y));
        vec4 c01 = fetchAtlasTexel(vec2(i0.x, i1.y));
        vec4 c11 = fetchAtlasTexel(i1);
        vec4 c0 = mix(c00, c10, f.x);
        vec4 c1 = mix(c01, c11, f.x);
        return mix(c0, c1, f.y);
      }
    `,
    main: /* glsl */ `
      outColor = sampleSwfAtlas(vSwfAtlasUV);
    `,
  },
};

const swfAtlasTextureBitGlLegacy = {
  name: "swf-atlas-texture-bit-legacy",
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

const swfColorFragmentMain = /* glsl */ `
      outColor = outColor * vMulColor * uTint;
      float swfA = outColor.a;
      outColor = outColor + step(0.01, swfA) * vAddColor;
`;

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
    main: swfColorFragmentMain,
  },
};

const swfColorPmaBitGl = {
  name: "swf-color-pma-bit",
  vertex: swfColorBitGl.vertex,
  fragment: {
    header: swfColorBitGl.fragment.header,
    main: /* glsl */ `
      ${swfColorFragmentMain}
      outColor.rgb *= outColor.a;
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

type SwfGlProgramSlot = "normal" | "pma" | "grab" | "mask";

const glProgramsHigh: Partial<Record<SwfGlProgramSlot, GlProgram>> = {};
const glProgramsLegacy: Partial<Record<SwfGlProgramSlot, GlProgram>> = {};

function invalidateShaderCacheIfNeeded(): void {
  if (shaderCacheVersion === SHADER_CACHE_VERSION) return;
  for (const key of Object.keys(glProgramsHigh) as SwfGlProgramSlot[]) {
    delete glProgramsHigh[key];
  }
  for (const key of Object.keys(glProgramsLegacy) as SwfGlProgramSlot[]) {
    delete glProgramsLegacy[key];
  }
  shaderCacheVersion = SHADER_CACHE_VERSION;
}

function compileSwfGlProgram(
  name: string,
  bits: HighShaderBit[],
  fragmentPrecision: "highp" | "mediump",
): GlProgram {
  return GlProgram.from({
    name,
    preferredFragmentPrecision: fragmentPrecision,
    preferredVertexPrecision: "highp",
    ...compileHighShaderGl({
      template: {
        vertex: vertexGlTemplate,
        fragment: fragmentGlTemplate,
      },
      bits: [globalUniformsBitGl, ...bits],
    }),
  });
}

function getGlProgram(
  grab: boolean,
  mask: boolean,
  pmaOutput: boolean,
  highPrecision: boolean,
): GlProgram {
  invalidateShaderCacheIfNeeded();
  const cache = highPrecision ? glProgramsHigh : glProgramsLegacy;
  const atlasBit = highPrecision
    ? swfAtlasTextureBitGlHigh
    : swfAtlasTextureBitGlLegacy;
  const suffix = highPrecision ? "-high" : "-legacy";
  const precision = highPrecision ? "highp" : "mediump";

  if (mask) {
    cache.mask ??= compileSwfGlProgram(`swf-mask-shader-atlas${suffix}`, [
      localUniformBitGl,
      atlasBit,
      swfMaskBitGl,
      roundPixelsBitGl,
    ], precision);
    return cache.mask;
  }
  if (grab) {
    cache.grab ??= compileSwfGlProgram(`swf-grab-shader-atlas${suffix}`, [
      localUniformBitGl,
      atlasBit,
      swfColorBitGl,
      swfGrabBitGl,
      roundPixelsBitGl,
    ], precision);
    return cache.grab;
  }
  if (pmaOutput) {
    cache.pma ??= compileSwfGlProgram(`swf-shader-atlas-pma${suffix}`, [
      localUniformBitGl,
      atlasBit,
      swfColorPmaBitGl,
      roundPixelsBitGl,
    ], precision);
    return cache.pma;
  }
  cache.normal ??= compileSwfGlProgram(`swf-shader-atlas${suffix}`, [
    localUniformBitGl,
    atlasBit,
    swfColorBitGl,
    roundPixelsBitGl,
  ], precision);
  return cache.normal;
}

export function createSwfShader(
  texture: Texture,
  grab: boolean,
  tint: [number, number, number, number],
  atlasWidth: number,
  atlasHeight: number,
  mask = false,
  grabSource: Texture["source"] | null = null,
  pmaOutput = false,
): Shader {
  const highPrecision = useHighPrecisionAtlasSampling(atlasWidth, atlasHeight);
  const swfUniforms = new UniformGroup({
    uTint: { value: new Float32Array(tint), type: "vec4<f32>" },
  });

  return new Shader({
    glProgram: getGlProgram(grab, mask, pmaOutput, highPrecision),
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
