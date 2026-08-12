import boundaries from 'eslint-plugin-boundaries';
import { layerDependencyPolicy, layerElements } from '../../../eslint/layer-policies.mjs';

export default [
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': import.meta.dirname,
      'boundaries/elements': layerElements,
    },
    rules: {
      'boundaries/dependencies': ['error', layerDependencyPolicy],
    },
  },
];
