define(
  'ephox.alloy.ui.schema.MenuSchema',

  [
    'ephox.alloy.api.focus.FocusManagers',
    'ephox.alloy.data.Fields',
    'ephox.boulder.api.FieldSchema',
    'ephox.boulder.api.ValueSchema',
    'ephox.katamari.api.Fun'
  ],

  function (FocusManagers, Fields, FieldSchema, ValueSchema, Fun) {
    var schema = [
      FieldSchema.strict('value'),
      FieldSchema.strict('items'),
      FieldSchema.strict('dom'),
      FieldSchema.strict('components'),


      FieldSchema.defaultedOf('movement', {
        mode: 'menu',
        moveOnTab: true
      }, ValueSchema.choose(
        'mode',
        {
          grid: [
            Fields.initSize(),
            FieldSchema.state('config', function () {
              return function (detail, movementInfo) {
                return {
                  mode: 'flatgrid',
                  selector: '.' + detail.markers().item(),
                  initSize: {
                    numColumns: movementInfo.initSize().numColumns(),
                    numRows: movementInfo.initSize().numRows()
                  },
                  focusManager: detail.focusManager()
                };
              };
            })
          ],
          menu: [
            FieldSchema.defaulted('moveOnTab', true),
            FieldSchema.state('config', function () {
              return function (detail, movementInfo) {
                return {
                  mode: 'menu',
                  selector: '.' + detail.markers().item(),
                  moveOnTab: movementInfo.moveOnTab(),
                  focusManager: detail.focusManager()
                };
              };
            })
          ]
        }
      )),

      Fields.itemMarkers(),

      Fields.members([ 'item' ]),
      FieldSchema.defaulted('shell', false),

      FieldSchema.defaulted('fakeFocus', false),
      FieldSchema.defaulted('focusManager', FocusManagers.dom()),
      Fields.onHandler('onHighlight')
    ];

    return {
      name: Fun.constant('Menu'),
      schema: Fun.constant(schema),
      parts: Fun.constant([ ])
    };
  }
);