// Local mock scenarios used by the Conversational Discovery sample.
// These examples are intentionally small and exist to exercise the frontend
// rendering contract, not to represent a full production catalog. Products
// are generic placeholders themed for a security / low-voltage distribution
// catalog (cameras, recorders, cabling) — swap freely per integration.
import type { BundleTierConfig, NextAction, ProductRecord, ValueMapEntry } from './models';

export type MockToolCall = {
  name: string;
  args?: string;
  result?: string;
};

function placeholderImage(label: string): string {
  return `https://placehold.co/800x800/e8ecff/4338ca.png?text=${encodeURIComponent(label)}`;
}

const cameras: ProductRecord[] = [
  {
    ec_product_id: 'cam-dome-4mp',
    ec_name: '4MP Indoor Dome IP Camera',
    ec_brand: 'SecureLine',
    ec_price: 249,
    ec_promo_price: 219,
    ec_image: placeholderImage('Dome\nCamera'),
    clickUri: '/products/4mp-indoor-dome-ip-camera',
    description: 'Discreet ceiling-mount dome for retail floors and offices.',
    accent: '#8fa1d6',
    resolution: '4MP',
    form_factor: 'Dome',
    connectivity: 'PoE'
  },
  {
    ec_product_id: 'cam-bullet-8mp',
    ec_name: '8MP Outdoor Bullet IP Camera',
    ec_brand: 'SecureLine',
    ec_price: 329,
    ec_image: placeholderImage('Bullet\nCamera'),
    clickUri: '/products/8mp-outdoor-bullet-ip-camera',
    description: 'Weatherproof 4K bullet with long-range IR for perimeters.',
    accent: '#7286c4',
    resolution: '8MP (4K)',
    form_factor: 'Bullet',
    connectivity: 'PoE'
  },
  {
    ec_product_id: 'cam-ptz-5mp',
    ec_name: '5MP PTZ Outdoor Camera',
    ec_brand: 'SecureLine',
    ec_price: 599,
    ec_image: placeholderImage('PTZ\nCamera'),
    clickUri: '/products/5mp-ptz-outdoor-camera',
    description: 'Pan-tilt-zoom coverage when one camera has to watch a wide area.',
    accent: '#5c6eb0',
    resolution: '5MP',
    form_factor: 'PTZ',
    connectivity: 'PoE+'
  }
];

const surveillanceBundleSlots: Record<string, ProductRecord[]> = {
  'bundle-surface-camera': [cameras[0]],
  'bundle-surface-recorder': [
    {
      ec_product_id: 'nvr-8ch-poe',
      ec_name: '8-Channel PoE NVR (2TB)',
      ec_brand: 'SecureLine',
      ec_price: 499,
      ec_image: placeholderImage('8-Ch\nNVR'),
      clickUri: '/products/8-channel-poe-nvr-2tb',
      description: 'Network video recorder with built-in PoE ports and 2TB storage.',
      accent: '#8fa1d6'
    }
  ],
  'bundle-surface-cabling': [
    {
      ec_product_id: 'cable-cat6-305m',
      ec_name: 'Cat6 UTP Cable — 305m Box',
      ec_brand: 'SecureLine',
      ec_price: 129,
      ec_image: placeholderImage('Cat6\nCable'),
      clickUri: '/products/cat6-utp-cable-305m-box',
      description: 'Pull-box of riser-rated Cat6 to wire every drop on the job.',
      accent: '#a9b6de'
    }
  ]
};

const cameraActions: NextAction[] = [
  { text: 'Compare the top two cameras', type: 'followup' },
  { text: 'Show 4K cameras under $400', type: 'search' },
  { text: 'What NVRs work with these cameras?', type: 'followup' }
];

const bundleActions: NextAction[] = [
  { text: 'Swap the NVR for a 16-channel model', type: 'followup' },
  { text: 'Add a second dome camera', type: 'followup' },
  { text: 'Build an access control bundle instead', type: 'search' }
];

export type MockScenario = {
  intro: string;
  reasoningText: string;
  toolCalls: MockToolCall[];
  textChunks: string[];
  stateSnapshot: Record<string, unknown>;
  activitySnapshots: Array<{
    messageId: string;
    activityType: string;
    operations: Record<string, unknown>[];
  }>;
};

function splitText(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean);
}

function buildProductItems(products: ProductRecord[]) {
  return products.map((product) => ({
    valueMap: Object.entries(product).reduce<ValueMapEntry[]>((result, [key, value]) => {
      if (value == null) {
        return result;
      }
      if (typeof value === 'number') {
        result.push({ key, valueNumber: value });
      } else {
        result.push({ key, valueString: String(value) });
      }
      return result;
    }, [])
  }));
}

function buildActionsItems(actions: NextAction[]) {
  return actions.map((action) => ({
    valueMap: [
      { key: 'text', valueString: action.text },
      { key: 'type', valueString: action.type }
    ]
  }));
}

function buildProductCarouselSnapshot(
  messageId: string,
  surfaceId: string,
  heading: string,
  products: ProductRecord[],
  actions: NextAction[]
) {
  return {
    messageId,
    activityType: 'a2ui-surface',
    operations: [
      {
        beginRendering: {
          surfaceId,
          root: `root-${surfaceId}`,
          catalogId: 'coveo-commerce-v1'
        }
      },
      {
        surfaceUpdate: {
          surfaceId,
          components: [
            {
              id: `root-${surfaceId}`,
              component: {
                ProductCarousel: {
                  heading: { literalString: heading },
                  products: {
                    componentId: `product-card-${surfaceId}`,
                    dataBinding: '/items'
                  }
                }
              }
            }
          ]
        }
      },
      {
        dataModelUpdate: {
          surfaceId,
          contents: [{ key: 'items', valueMap: buildProductItems(products) }]
        }
      },
      {
        beginRendering: {
          surfaceId: 'next-actions-surface',
          root: 'root-next-actions-surface',
          catalogId: 'coveo-commerce-v1'
        }
      },
      {
        surfaceUpdate: {
          surfaceId: 'next-actions-surface',
          components: [
            {
              id: 'root-next-actions-surface',
              component: {
                NextActionsBar: {
                  actions: {
                    componentId: 'button-next-actions-surface',
                    dataBinding: '/actions'
                  }
                }
              }
            }
          ]
        }
      },
      {
        dataModelUpdate: {
          surfaceId: 'next-actions-surface',
          contents: [{ key: 'actions', valueMap: buildActionsItems(actions) }]
        }
      }
    ]
  };
}

function buildComparisonSnapshot(
  messageId: string,
  surfaceId: string,
  heading: string,
  products: ProductRecord[],
  attributes: string[],
  summary: string,
  actions: NextAction[]
) {
  return {
    messageId,
    activityType: 'a2ui-surface',
    operations: [
      {
        beginRendering: {
          surfaceId,
          root: `root-${surfaceId}`,
          catalogId: 'coveo-commerce-v1'
        }
      },
      {
        surfaceUpdate: {
          surfaceId,
          components: [
            {
              id: `root-${surfaceId}`,
              component: {
                ComparisonTable: {
                  heading: { literalString: heading },
                  attributes,
                  products: {
                    componentId: `comparison-card-${surfaceId}`,
                    dataBinding: '/items'
                  }
                }
              }
            },
            {
              id: `comparison-card-${surfaceId}`,
              component: {
                ProductCard: {
                  ec_product_id: { path: 'ec_product_id' },
                  ec_name: { path: 'ec_name' },
                  ec_brand: { path: 'ec_brand' },
                  ec_image: { path: 'ec_image' },
                  ec_price: { path: 'ec_price' },
                  ec_promo_price: { path: 'ec_promo_price' }
                }
              }
            }
          ]
        }
      },
      {
        dataModelUpdate: {
          surfaceId,
          contents: [{ key: 'items', valueMap: buildProductItems(products) }]
        }
      },
      {
        beginRendering: {
          surfaceId: 'comparison-summary-surface',
          root: 'root-comparison-summary-surface',
          catalogId: 'coveo-commerce-v1'
        }
      },
      {
        surfaceUpdate: {
          surfaceId: 'comparison-summary-surface',
          components: [
            {
              id: 'root-comparison-summary-surface',
              component: {
                ComparisonSummary: {
                  text: { literalString: summary }
                }
              }
            }
          ]
        }
      },
      {
        beginRendering: {
          surfaceId: 'next-actions-surface',
          root: 'root-next-actions-surface',
          catalogId: 'coveo-commerce-v1'
        }
      },
      {
        surfaceUpdate: {
          surfaceId: 'next-actions-surface',
          components: [
            {
              id: 'root-next-actions-surface',
              component: {
                NextActionsBar: {
                  actions: {
                    componentId: 'button-next-actions-surface',
                    dataBinding: '/actions'
                  }
                }
              }
            }
          ]
        }
      },
      {
        dataModelUpdate: {
          surfaceId: 'next-actions-surface',
          contents: [{ key: 'actions', valueMap: buildActionsItems(actions) }]
        }
      }
    ]
  };
}

function buildBundleSnapshot(
  messageId: string,
  title: string,
  bundles: BundleTierConfig[],
  actions: NextAction[]
) {
  return {
    messageId,
    activityType: 'a2ui-surface',
    operations: [
      ...Object.entries(surveillanceBundleSlots).flatMap(([surfaceId, products]) => [
        {
          beginRendering: {
            surfaceId,
            root: `root-${surfaceId}`,
            catalogId: 'coveo-commerce-v1'
          }
        },
        {
          surfaceUpdate: {
            surfaceId,
            components: [
              {
                id: `root-${surfaceId}`,
                component: {
                  ProductCard: {
                    ec_product_id: { path: 'ec_product_id' },
                    ec_name: { path: 'ec_name' },
                    ec_brand: { path: 'ec_brand' },
                    ec_image: { path: 'ec_image' },
                    ec_price: { path: 'ec_price' },
                    ec_promo_price: { path: 'ec_promo_price' }
                  }
                }
              }
            ]
          }
        },
        {
          dataModelUpdate: {
            surfaceId,
            contents: [{ key: 'items', valueMap: buildProductItems(products) }]
          }
        }
      ]),
      {
        beginRendering: {
          surfaceId: 'bundle-display-surface',
          root: 'root-bundle-display-surface',
          catalogId: 'coveo-commerce-v1'
        }
      },
      {
        surfaceUpdate: {
          surfaceId: 'bundle-display-surface',
          components: [
            {
              id: 'root-bundle-display-surface',
              component: {
                BundleDisplay: {
                  title: { literalString: title },
                  bundles
                }
              }
            }
          ]
        }
      },
      {
        beginRendering: {
          surfaceId: 'next-actions-surface',
          root: 'root-next-actions-surface',
          catalogId: 'coveo-commerce-v1'
        }
      },
      {
        surfaceUpdate: {
          surfaceId: 'next-actions-surface',
          components: [
            {
              id: 'root-next-actions-surface',
              component: {
                NextActionsBar: {
                  actions: {
                    componentId: 'button-next-actions-surface',
                    dataBinding: '/actions'
                  }
                }
              }
            }
          ]
        }
      },
      {
        dataModelUpdate: {
          surfaceId: 'next-actions-surface',
          contents: [{ key: 'actions', valueMap: buildActionsItems(actions) }]
        }
      }
    ]
  };
}

function buildCarouselSkeleton(surfaceId: string, heading: string) {
  return {
    messageId: 'activity-products',
    activityType: 'a2ui-surface',
    operations: [
      {
        beginRendering: {
          surfaceId,
          root: `root-${surfaceId}`,
          catalogId: 'coveo-commerce-v1'
        }
      },
      {
        surfaceUpdate: {
          surfaceId,
          components: [
            {
              id: `root-${surfaceId}`,
              component: {
                ProductCarousel: {
                  heading: {
                    literalString: heading
                  },
                  isLoading: true
                }
              }
            }
          ]
        }
      }
    ]
  };
}

function buildComparisonSkeleton(surfaceId: string, heading: string) {
  return {
    messageId: 'activity-compare',
    activityType: 'a2ui-surface',
    operations: [
      {
        beginRendering: {
          surfaceId,
          root: `root-${surfaceId}`,
          catalogId: 'coveo-commerce-v1'
        }
      },
      {
        surfaceUpdate: {
          surfaceId,
          components: [
            {
              id: `root-${surfaceId}`,
              component: {
                ComparisonTable: {
                  heading: { literalString: heading },
                  isLoading: true
                }
              }
            }
          ]
        }
      }
    ]
  };
}

function buildBundleSkeleton() {
  return {
    messageId: 'activity-bundle',
    activityType: 'a2ui-surface',
    operations: [
      {
        beginRendering: {
          surfaceId: 'bundle-display-surface',
          root: 'root-bundle-display-surface',
          catalogId: 'coveo-commerce-v1'
        }
      },
      {
        surfaceUpdate: {
          surfaceId: 'bundle-display-surface',
          components: [
            {
              id: 'root-bundle-display-surface',
              component: {
                BundleDisplay: {
                  title: { literalString: 'Building a surveillance kit' },
                  isLoading: true
                }
              }
            }
          ]
        }
      }
    ]
  };
}

function buildNextActionsSkeleton() {
  return {
    messageId: 'activity-actions',
    activityType: 'a2ui-surface',
    operations: [
      {
        beginRendering: {
          surfaceId: 'next-actions-surface',
          root: 'root-next-actions-surface',
          catalogId: 'coveo-commerce-v1'
        }
      },
      {
        surfaceUpdate: {
          surfaceId: 'next-actions-surface',
          components: [
            {
              id: 'root-next-actions-surface',
              component: {
                NextActionsBar: {
                  isLoading: true
                }
              }
            }
          ]
        }
      }
    ]
  };
}

export function getMockScenario(prompt: string): MockScenario {
  const normalized = prompt.toLowerCase();

  if (normalized.includes('bundle') || normalized.includes('kit')) {
    return {
      intro:
        'I put together a small-business surveillance kit with a discreet dome camera, an 8-channel PoE recorder, and the cabling to wire every drop, so the install is covered end to end from one order.',
      reasoningText:
        'The request points toward a coordinated project recommendation rather than a single product shortlist. A compact kit with a camera, a recorder, and cabling should make the install intent clearer.',
      toolCalls: [
        {
          name: 'route',
          args: '{"intent":"bundle"}',
          result: 'Routed to bundle curation flow.'
        },
        {
          name: 'render_bundle_display',
          args: '{"bundleType":"small_business_surveillance"}',
          result: 'Prepared structured bundle surface.'
        },
        {
          name: 'render_next_actions',
          args: '{"count":3}',
          result: 'Prepared follow-up actions.'
        }
      ],
      textChunks: splitText(
        'I put together a small-business surveillance kit with a discreet dome camera, an 8-channel PoE recorder, and the cabling to wire every drop, so the install is covered end to end from one order.'
      ),
      stateSnapshot: {
        policy_execution_state: {
          current_state: 'respond/complete',
          state_history: [
            ['route/intake', 'graph'],
            ['discovery/bundle_curate', 'graph'],
            ['respond/complete', 'graph']
          ],
          iteration_count: 3
        },
        label: 'Assembling a surveillance kit'
      },
      activitySnapshots: [
        buildBundleSkeleton(),
        buildNextActionsSkeleton(),
        buildBundleSnapshot('activity-bundle', 'Small-business surveillance kit', [
          {
            bundleId: 'tier-starter',
            label: 'Starter kit',
            description: 'A balanced camera, recorder, and cabling setup for a first install.',
            slots: [
              { categoryLabel: 'Camera', surfaceRef: 'bundle-surface-camera' },
              { categoryLabel: 'Recorder', surfaceRef: 'bundle-surface-recorder' },
              { categoryLabel: 'Cabling', surfaceRef: 'bundle-surface-cabling' }
            ]
          }
        ], bundleActions)
      ]
    };
  }

  if (normalized.includes('compare') || normalized.includes('vs')) {
    return {
      intro:
        'I compared three camera directions so you can weigh image resolution, form factor, and how much coverage a single unit needs to deliver.',
      reasoningText:
        'The shopper is asking for tradeoffs, so comparison is more useful than a simple product list. The key attributes are resolution, form factor, and connectivity.',
      toolCalls: [
        {
          name: 'route',
          args: '{"intent":"compare"}',
          result: 'Routed to comparison flow.'
        },
        {
          name: 'coveo_commerce_search',
          args: '{"query":"IP cameras","limit":3}',
          result: 'Retrieved three camera candidates.'
        },
        {
          name: 'render_comparison_table',
          args: '{"attributes":["resolution","form_factor","connectivity"]}',
          result: 'Prepared comparison surface.'
        },
        {
          name: 'render_next_actions',
          args: '{"count":3}',
          result: 'Prepared follow-up actions.'
        }
      ],
      textChunks: splitText(
        'I compared three camera directions so you can weigh image resolution, form factor, and how much coverage a single unit needs to deliver.'
      ),
      stateSnapshot: {
        policy_execution_state: {
          current_state: 'respond/complete',
          state_history: [
            ['route/intake', 'graph'],
            ['discovery/compare', 'graph'],
            ['respond/complete', 'graph']
          ],
          iteration_count: 3
        },
        label: 'Comparing products'
      },
      activitySnapshots: [
        buildComparisonSkeleton('comparison-surface-cameras', 'Comparing IP cameras'),
        buildNextActionsSkeleton(),
        buildComparisonSnapshot(
          'activity-compare',
          'comparison-surface-cameras',
          'IP cameras to compare',
          cameras,
          ['resolution', 'form_factor', 'connectivity'],
          'The 8MP bullet gives you the sharpest image per dollar for perimeters, the 4MP dome is the most discreet choice for indoor retail, and the PTZ is the pick when one camera has to sweep a wide area.',
          cameraActions
        )
      ]
    };
  }

  return {
    intro:
      'I found a few camera directions that cover dome, bullet, and PTZ form factors so you can decide whether discretion, reach, or flexible coverage matters most for the install.',
    reasoningText:
      'The request is broad, so a shortlist is the best first response. The set should cover distinct form factors so the shopper can react to a direction rather than a single product.',
    toolCalls: [
      {
        name: 'route',
        args: '{"intent":"discover"}',
        result: 'Routed to discovery flow.'
      },
      {
        name: 'coveo_commerce_search',
        args: '{"query":"IP cameras","use_case":"small business install","limit":3}',
        result: 'Retrieved camera shortlist.'
      },
      {
        name: 'render_product_carousel',
        args: '{"surface":"products-surface-cameras"}',
        result: 'Prepared product carousel.'
      },
      {
        name: 'render_next_actions',
        args: '{"count":3}',
        result: 'Prepared follow-up actions.'
      }
    ],
    textChunks: splitText(
      'I found a few camera directions that cover dome, bullet, and PTZ form factors so you can decide whether discretion, reach, or flexible coverage matters most for the install.'
    ),
    stateSnapshot: {
      policy_execution_state: {
        current_state: 'respond/complete',
        state_history: [
          ['route/intake', 'graph'],
          ['discovery/search_or_render', 'graph'],
          ['respond/complete', 'graph']
        ],
        iteration_count: 3
      },
      label: 'Searching cameras'
    },
    activitySnapshots: [
        buildCarouselSkeleton(
          'products-surface-cameras',
          'Pulling together cameras that fit a small business install'
        ),
        buildNextActionsSkeleton(),
        buildProductCarouselSnapshot(
          'activity-products',
          'products-surface-cameras',
          'Cameras for a small business install',
          cameras,
          cameraActions
        )
      ]
    };
  }
