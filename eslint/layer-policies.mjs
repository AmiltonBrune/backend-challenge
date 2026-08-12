export const layerElements = [
  { type: 'domain', pattern: 'src/domain/**' },
  { type: 'application', pattern: 'src/application/**' },
  { type: 'infrastructure', pattern: 'src/infrastructure/**' },
  { type: 'interface', pattern: 'src/interface/**' },
  { type: 'workers', pattern: 'src/workers/**' },
];

const anyExternalOrCore = { module: { origin: ['external', 'core'] } };

export const layerDependencyPolicy = {
  default: 'disallow',
  checkAllOrigins: true,
  policies: [
    {
      from: { element: { type: 'domain' } },
      allow: [{ to: { module: { origin: 'external', source: 'decimal.js' } } }],
    },
    {
      from: { element: { type: 'application' } },
      allow: [{ to: { element: { type: 'domain' } } }, { to: anyExternalOrCore }],
    },
    {
      from: { element: { type: 'infrastructure' } },
      allow: [
        { to: { element: { type: ['domain', 'application'] } } },
        { to: anyExternalOrCore },
      ],
    },
    {
      from: { element: { type: 'interface' } },
      allow: [
        { to: { element: { type: ['domain', 'application'] } } },
        { to: anyExternalOrCore },
      ],
    },
    {
      from: { element: { type: 'workers' } },
      allow: [
        { to: { element: { type: ['domain', 'application', 'infrastructure'] } } },
        { to: anyExternalOrCore },
      ],
    },
  ],
};
