export const layerElements = [
  { type: 'domain', pattern: 'src/domain/**' },
  { type: 'application', pattern: 'src/application/**' },
  { type: 'infrastructure', pattern: 'src/infrastructure/**' },
  { type: 'interface', pattern: 'src/interface/**' },
  { type: 'workers', pattern: 'src/workers/**' },
];

export const layerDependencyPolicy = {
  default: 'disallow',
  checkAllOrigins: true,
  policies: [
    {
      from: { element: { type: 'domain' } },
      allow: [],
    },
    {
      from: { element: { type: 'application' } },
      allow: [{ to: { element: { type: 'domain' } } }],
    },
    {
      from: { element: { type: 'infrastructure' } },
      allow: [{ to: { element: { type: ['domain', 'application'] } } }],
    },
    {
      from: { element: { type: 'interface' } },
      allow: [{ to: { element: { type: ['domain', 'application'] } } }],
    },
    {
      from: { element: { type: 'workers' } },
      allow: [{ to: { element: { type: ['domain', 'application', 'infrastructure'] } } }],
    },
  ],
};
