import { Event, Node as DomNode, Range, Element } from '@ephox/dom-globals';
import { Fun, Obj, Option, Type } from '@ephox/katamari';
import Editor from './api/Editor';
import Node from './api/html/Node';
import Serializer from './api/html/Serializer';
import * as FilterNode from './html/FilterNode';
import * as Operations from './undo/Operations';
import { Index, Locks, UndoBookmark, UndoLevel, UndoLevelType, UndoManager } from './undo/UndoManagerTypes';
import * as ApplyFormat from './fmt/ApplyFormat';
import * as RemoveFormat from './fmt/RemoveFormat';
import * as ToggleFormat from './fmt/ToggleFormat';
import { RangeLikeObject } from './selection/RangeTypes';
import { FormatRegistry } from './fmt/FormatRegistry';
import { Content } from './content/EditorContent';
import { GetContentArgs, ContentFormat, getContentInternal } from './content/GetContentImpl';
import { SetContentArgs, setContentInternal } from './content/SetContentImpl';
import { insertHtmlAtCaret } from './content/InsertContentImpl';
import { getSelectedContentInternal } from './selection/GetSelectionContentImpl';
import Promise from './api/util/Promise';

const isTreeNode = (content: any): content is Node => content instanceof Node;

const isSupportedContentFormat = (format: string) => format !== 'text';

const async = (fn: () => void) => {
  // tslint:disable-next-line:no-unused-expression
  new Promise((resolve) => {
    fn();
    resolve();
  });
};

/** API implemented by the RTC plugin */
interface RtcRuntimeApi {
  undo: () => void;
  redo: () => void;
  hasUndo: () => boolean;
  hasRedo: () => boolean;
  transact: (fn: () => void) => void;
  applyFormat: (format: string, vars: Record<string, string>) => void;
  removeFormat: (format: string, vars: Record<string, string>) => void;
  toggleFormat: (format: string, vars: Record<string, string>) => void;
  getContent: () => Node | null;
  setContent: (node: Node) => void;
  insertContent: (node: Node) => void;
  getSelectedContent: () => Node | null;
  getRawModel: () => any;
  setAttributesOnViewElement: (elm: Element, attrs: Record<string, string>) => void;
  isRemote: boolean;
}

/** A copy of the TinyMCE api definitions that the plugin overrides  */
interface RtcAdaptor {
  undoManager: {
    beforeChange: (locks: Locks, beforeBookmark: UndoBookmark) => void
    addUndoLevel: (undoManager: UndoManager, index: Index, locks: Locks, beforeBookmark: UndoBookmark, level?: UndoLevel, event?: Event) => UndoLevel
    undo: (undoManager: UndoManager, locks: Locks, index: Index) => UndoLevel
    redo: (index: Index, data: UndoLevel[]) => UndoLevel
    clear: (undoManager: UndoManager, index: Index) => void
    reset: (undoManager: UndoManager) => void
    hasUndo: (undoManager: UndoManager, index: Index) => boolean
    hasRedo: (undoManager: UndoManager, index: Index) => boolean
    transact: (undoManager: UndoManager, locks: Locks, callback: () => void) => UndoLevel
    ignore: (locks: Locks, callback: () => void) => void
    extra: (undoManager: UndoManager, index: Index, callback1: () => void, callback2: () => void) => void
  };
  formatter: {
    applyFormat: (format: string, vars?: Record<string, string>, node?: DomNode | RangeLikeObject) => void;
    removeFormat: (name: string, vars?: Record<string, string>, node?: DomNode | Range) => void;
    toggleFormat: (formats: FormatRegistry, name: string, vars: Record<string, string>, node: DomNode) => void;
  };
  editor: {
    getContent: (args: GetContentArgs, format: ContentFormat) => Content;
    setContent: (content: Content, args: SetContentArgs) => Content;
    insertContent: (value: string, details) => void;
    getSelectedContent: (format: ContentFormat, args) => string;
  };
  view: {
    setAttributes: (target: Element, attrs: Record<string, string>) => void;
  };
  raw: {
    getModel: () => Option<any>
  };
}

interface RtcPluginApi {
  setup: () => Promise<RtcRuntimeApi>;
}

// TODO: Perhaps this should be a core API for overriding
interface RtcEditor extends Editor {
  rtcInstance: RtcAdaptor;
}

const createDummyUndoLevel = (): UndoLevel => {
  return {
    type: UndoLevelType.Complete,
    fragments: [],
    content: '',
    bookmark: null,
    beforeBookmark: null
  };
};

const makePlainAdaptor = (editor: Editor): RtcAdaptor => ({
  undoManager: {
    beforeChange: (locks, beforeBookmark) => Operations.beforeChange(editor, locks, beforeBookmark),
    addUndoLevel: (undoManager, index, locks, beforeBookmark, level, event) => Operations.addUndoLevel(editor, undoManager, index, locks, beforeBookmark, level, event),
    undo: (undoManager, locks, index) => Operations.undo(editor, undoManager, locks, index),
    redo: (index, data) => Operations.redo(editor, index, data),
    clear: (undoManager, index) => Operations.clear(editor, undoManager, index),
    reset: (undoManager) => Operations.reset(undoManager),
    hasUndo: (undoManager, index) => Operations.hasUndo(editor, undoManager, index),
    hasRedo: (undoManager, index) => Operations.hasRedo(undoManager, index),
    transact: (undoManager, locks, callback) => Operations.transact(undoManager, locks, callback),
    ignore: (locks, callback) => Operations.ignore(locks, callback),
    extra: (undoManager, index, callback1, callback2) => Operations.extra(editor, undoManager, index, callback1, callback2)
  },
  formatter: {
    applyFormat: (name, vars?, node?) => ApplyFormat.applyFormat(editor, name, vars, node),
    removeFormat: (name, vars, node) => RemoveFormat.remove(editor, name, vars, node),
    toggleFormat: (formats, name, vars, node) => ToggleFormat.toggle(editor, formats, name, vars, node),
  },
  editor: {
    getContent: (args, format) =>  getContentInternal(editor, args, format),
    setContent: (content, args) => setContentInternal(editor, content, args),
    insertContent: (value, details) => insertHtmlAtCaret(editor, value, details),
    getSelectedContent: (format, args) => getSelectedContentInternal(editor, format, args)
  },
  view: {
    setAttributes: (target, attributes) => async(() => editor.dom.setAttribs(target, attributes))
  },
  raw: {
    getModel: () => Option.none()
  }
});

const makeRtcAdaptor = (tinymceEditor: Editor, rtcEditor: RtcRuntimeApi): RtcAdaptor => {
  const defaultVars = (vars: Record<string, string>) => Type.isObject(vars) ? vars : {};
  const unsupported = Fun.die('Unimplemented feature for rtc');
  const ignore = Fun.noop;
  return {
    undoManager: {
      beforeChange: ignore,
      addUndoLevel: unsupported,
      undo: () => {
        rtcEditor.undo();
        return createDummyUndoLevel();
      },
      redo: () => {
        rtcEditor.redo();
        return createDummyUndoLevel();
      },
      clear: unsupported,
      reset: unsupported,
      hasUndo: () => rtcEditor.hasUndo(),
      hasRedo: () => rtcEditor.hasRedo(),
      transact: (_undoManager, _locks, fn) => {
        rtcEditor.transact(fn);
        return createDummyUndoLevel();
      },
      ignore: unsupported,
      extra: unsupported
    },
    formatter: {
      applyFormat: (name, vars, _node) => rtcEditor.applyFormat(name, defaultVars(vars)),
      removeFormat: (name, vars, _node) => rtcEditor.removeFormat(name, defaultVars(vars)),
      toggleFormat: (_formats, name, vars, _node) => rtcEditor.toggleFormat(name, defaultVars(vars)),
    },
    editor: {
      getContent: (args, format) => {
        if (isSupportedContentFormat(format)) {
          const fragment = rtcEditor.getContent();
          const serializer = Serializer({ inner: true });

          FilterNode.filter(tinymceEditor.serializer.getNodeFilters(), tinymceEditor.serializer.getAttributeFilters(), fragment);

          return serializer.serialize(fragment);
        } else {
          return makePlainAdaptor(tinymceEditor).editor.getContent(args, format);
        }
      },
      getSelectedContent: (format, args) => {
        if (isSupportedContentFormat(format)) {
          const fragment = rtcEditor.getSelectedContent();
          const serializer = Serializer({});
          return serializer.serialize(fragment);
        } else {
          return makePlainAdaptor(tinymceEditor).editor.getSelectedContent(format, args);
        }
      },
      setContent: (content, _args) => {
        const fragment = isTreeNode(content) ? content : tinymceEditor.parser.parse(content, { isRootContent: true, insert: true });
        rtcEditor.setContent(fragment);
        return content;
      },
      insertContent: (value, _details) => {
        const fragment = isTreeNode(value) ? value : tinymceEditor.parser.parse(value, { insert: true });
        rtcEditor.insertContent(fragment);
      }
    },
    view: {
      setAttributes: (target, attributes) => rtcEditor.setAttributesOnViewElement(target, attributes)
    },
    raw: {
      getModel: () => Option.some(rtcEditor.getRawModel())
    }
  };
};

export const isRtc = (editor) => Obj.has(editor.plugins, 'rtc');

export const setup = (editor: Editor): Option<Promise<boolean>> => {
  const editorCast = editor as RtcEditor;
  return (Obj.get(editor.plugins, 'rtc') as Option<RtcPluginApi>).fold(
    () => {
      editorCast.rtcInstance = makePlainAdaptor(editor);
      return Option.none();
    },
    (rtc) => Option.some(
      rtc.setup().then((rtcEditor) => {
        editorCast.rtcInstance = makeRtcAdaptor(editor, rtcEditor);
        return rtcEditor.isRemote;
      })
    )
  );
};

/** In theory these could all be inlined but having them here makes it clear what is overridden */
export const beforeChange = (editor: Editor, locks: Locks, beforeBookmark: UndoBookmark) => {
  (editor as RtcEditor).rtcInstance.undoManager.beforeChange(locks, beforeBookmark);
};

export const addUndoLevel = (editor: Editor, undoManager: UndoManager, index: Index, locks: Locks, beforeBookmark: UndoBookmark, level?: UndoLevel, event?: Event): UndoLevel => {
  return (editor as RtcEditor).rtcInstance.undoManager.addUndoLevel(undoManager, index, locks, beforeBookmark, level, event);
};

export const undo = (editor: Editor, undoManager: UndoManager, locks: Locks, index: Index): UndoLevel => {
  return (editor as RtcEditor).rtcInstance.undoManager.undo(undoManager, locks, index);
};

export const redo = (editor: Editor, index: Index, data: UndoLevel[]): UndoLevel => {
  return (editor as RtcEditor).rtcInstance.undoManager.redo(index, data);
};

export const clear = (editor: Editor, undoManager: UndoManager, index: Index): void => {
  (editor as RtcEditor).rtcInstance.undoManager.clear(undoManager, index);
};

export const reset = (editor: Editor, undoManager: UndoManager): void => {
  (editor as RtcEditor).rtcInstance.undoManager.reset(undoManager);
};

export const hasUndo = (editor: Editor, undoManager: UndoManager, index: Index): boolean => {
  return (editor as RtcEditor).rtcInstance.undoManager.hasUndo(undoManager, index);
};

export const hasRedo = (editor: Editor, undoManager: UndoManager, index: Index): boolean => {
  return (editor as RtcEditor).rtcInstance.undoManager.hasRedo(undoManager, index);
};

export const transact = (editor: Editor, undoManager: UndoManager, locks: Locks, callback: () => void): UndoLevel => {
  return (editor as RtcEditor).rtcInstance.undoManager.transact(undoManager, locks, callback);
};

export const ignore = (editor: Editor, locks: Locks, callback: () => void): void => {
  (editor as RtcEditor).rtcInstance.undoManager.ignore(locks, callback);
};

export const extra = (editor: Editor, undoManager: UndoManager, index: Index, callback1: () => void, callback2: () => void): void => {
  (editor as RtcEditor).rtcInstance.undoManager.extra(undoManager, index, callback1, callback2);
};

export const applyFormat = (editor: Editor, name: string, vars?: Record<string, string>, node?: DomNode | RangeLikeObject): void => {
  (editor as RtcEditor).rtcInstance.formatter.applyFormat(name, vars, node);
};

export const removeFormat = (editor: Editor, name: string, vars?: Record<string, string>, node?: DomNode | Range) => {
  (editor as RtcEditor).rtcInstance.formatter.removeFormat(name, vars, node);
};

export const toggleFormat = (editor: Editor, formats: FormatRegistry, name: string, vars: Record<string, string>, node: DomNode): void => {
  (editor as RtcEditor).rtcInstance.formatter.toggleFormat(formats, name, vars, node);
};

export const getContent = (editor: Editor, args: GetContentArgs, format: ContentFormat): Content => {
  return (editor as RtcEditor).rtcInstance.editor.getContent(args, format);
};

export const setContent = (editor: Editor, content: Content, args: SetContentArgs): Content => {
  return (editor as RtcEditor).rtcInstance.editor.setContent(content, args);
};

export const insertContent = (editor: Editor, value: string, details): void => {
  return (editor as RtcEditor).rtcInstance.editor.insertContent(value, details);
};

export const getSelectedContent = (editor: Editor, format: ContentFormat, args): string => {
  return (editor as RtcEditor).rtcInstance.editor.getSelectedContent(format, args);
};

export const setAttributesOnViewElement = (editor: Editor, elm: Element, attrs: Record<string, string>): void => {
  return (editor as RtcEditor).rtcInstance.view.setAttributes(elm, attrs);
};
