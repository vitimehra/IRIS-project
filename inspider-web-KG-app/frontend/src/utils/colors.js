/**
 * Cluster palette. Twenty-four muted hues that read against the dark ground and
 * stay distinguishable in the dense map. Cluster ids cycle through it.
 */
export const CLUSTER_PALETTE = [
  [255, 159, 28], [79, 209, 197], [244, 114, 182], [129, 140, 248], [163, 230, 53],
  [251, 191, 36], [56, 189, 248], [248, 113, 113], [52, 211, 153], [192, 132, 252],
  [251, 146, 60], [45, 212, 191], [232, 121, 249], [96, 165, 250], [190, 242, 100],
  [253, 224, 71], [34, 211, 238], [252, 165, 165], [110, 231, 183], [216, 180, 254],
  [253, 186, 116], [94, 234, 212], [240, 171, 252], [147, 197, 253],
];

export function clusterRgb(clusterId) {
  return CLUSTER_PALETTE[((clusterId % CLUSTER_PALETTE.length) + CLUSTER_PALETTE.length) % CLUSTER_PALETTE.length];
}

export function clusterCss(clusterId, alpha = 1) {
  const [r, g, b] = clusterRgb(clusterId);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Similarity 0..1 -> strand opacity and width, so close strands read as taut. */
export function strandStyle(sim, lo, hi) {
  const span = Math.max(1e-6, hi - lo);
  const t = Math.max(0, Math.min(1, (sim - lo) / span));
  return { opacity: 0.18 + t * 0.72, width: 0.6 + t * 2.2 };
}
