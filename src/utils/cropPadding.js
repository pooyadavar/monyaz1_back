const CROP_PADDING_RATIO = 0.14;

const expandCropWithPadding = (crop, paddingRatio = CROP_PADDING_RATIO) => {
  const padX = crop.width * paddingRatio;
  const padY = crop.height * paddingRatio;

  const x = Math.max(0, crop.x - padX);
  const y = Math.max(0, crop.y - padY);
  const width = Math.min(100 - x, crop.width + padX * 2);
  const height = Math.min(100 - y, crop.height + padY * 2);

  return { x, y, width, height };
};

module.exports = { CROP_PADDING_RATIO, expandCropWithPadding };
