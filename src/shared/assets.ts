import { z } from 'zod';

export const MAX_ASSET_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_ASSET_FILENAME_LENGTH = 255;

export const assetIdSchema = z.string().uuid();

export interface AssetResponse {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentUrl: string;
}

export const assetResponseSchema = z
  .object({
    id: assetIdSchema,
    filename: z.string().min(1).max(MAX_ASSET_FILENAME_LENGTH),
    mimeType: z.string().min(1).max(255),
    sizeBytes: z.number().int().nonnegative().max(MAX_ASSET_SIZE_BYTES),
    contentUrl: z.string().min(1),
  })
  .strict();

export const assetResponseEnvelopeSchema = z.object({ asset: assetResponseSchema }).strict();
