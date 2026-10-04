import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

/** The same own stone maps as the GLB shoulders; opaque glTF-compatible PBR. */
export function createDistantTerrainMaterial(scene: Scene): PBRMaterial {
  const base = `${import.meta.env.BASE_URL}models/environment/road-v1/`;
  const material = new PBRMaterial('RF_Own_distant_stone', scene);
  const map = (file: string, color: boolean) => {
    // Match the glTF loader's texture orientation for the same authored maps.
    const texture = new Texture(base + file, scene, false, false);
    texture.gammaSpace = color;
    texture.uScale = texture.vScale = 220 / 6;
    texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
    return texture;
  };
  material.albedoTexture = map('RF_stone_BaseColor.png', true);
  material.bumpTexture = map('RF_stone_Normal.png', false);
  material.bumpTexture.level = 0.35;
  material.invertNormalMapX = !scene.useRightHandedSystem;
  material.invertNormalMapY = scene.useRightHandedSystem;
  material.metallicTexture = map('RF_stone_ORM.png', false);
  material.useRoughnessFromMetallicTextureAlpha = false;
  material.useRoughnessFromMetallicTextureGreen = true;
  material.useMetallnessFromMetallicTextureBlue = true;
  material.useAmbientOcclusionFromMetallicTextureRed = true;
  material.metallic = 0;
  material.roughness = 1;
  return material;
}
