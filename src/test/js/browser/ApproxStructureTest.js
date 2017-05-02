asynctest(
  'ApproxStructureTest',
 
  [
    'ephox.agar.api.ApproxStructure',
    'ephox.agar.api.Assertions',
    'ephox.sugar.api.node.Element'
  ],
 
  function (ApproxStructure, Assertions, Element) {
    var success = arguments[arguments.length - 2];
    var failure = arguments[arguments.length - 1];
 
    var html = '<div data-key="test-1" selected="double" class="test1 root" style="display: block;">' +
      '<div selected="true">' +
        '<span data-ephox-id="blah" class="disabled">span</span>' +
      '</div>' +
      'words' + 
      '<span></span>' +
    '</div>';

    var check = function (expected, input) {
      var target = Element.fromHtml(input);
      Assertions.assertStructure('Test', expected, target);
    };

    check(ApproxStructure.build(function (s, str, arr) {
      return s.element('div', {
        attrs: {
          selected: str.is('double'),
          car: str.none('no car attribute')
        },
        classes: [
          arr.has('test1'),
          arr.not('dog'),
          arr.hasPrefix('tes')
        ],
        styles: {
          display: str.is('block')
        },
        children: [
          s.element('div', {
            attrs: {
              selected: str.is('true')
            },
            children: [
              s.element('span', {
                attrs: {
                  'data-ephox-id': str.startsWith('bl')
                },
                classes: [
                  arr.not('enabled'),
                  arr.has('disabled')
                ],
                html: str.is('span')
              })
            ]
          }),
          s.text(
            str.is('words')
          ),
          s.anything()
        ]
      });
    }), html);


    success();
  }
);