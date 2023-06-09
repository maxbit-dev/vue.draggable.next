import Sortable, { MultiDrag } from "sortablejs";
import { insertNodeAt, removeNode } from "./util/htmlHelper";
import { console } from "./util/console";
import {
  getComponentAttributes,
  createSortableOption,
  getValidSortableEntries
} from "./core/componentBuilderHelper";
import { computeComponentStructure } from "./core/renderHelper";
import { events } from "./core/sortableEvents";
import { h, defineComponent, nextTick } from "vue";

let MULTIDRAG;

if (!MULTIDRAG) {
  MULTIDRAG = new MultiDrag()
  Sortable.mount(MULTIDRAG);
}

function emit(evtName, evtData) {
  nextTick(() => this.$emit(evtName.toLowerCase(), evtData));
}

function manage(evtName) {
  return (evtData, originalElement) => {
    if (this.realList !== null) {
      return this[`onDrag${evtName}`](evtData, originalElement);
    }
  };
}

function manageAndEmit(evtName) {
  const delegateCallBack = manage.call(this, evtName);
  return (evtData, originalElement) => {
    delegateCallBack.call(this, evtData, originalElement);
    emit.call(this, evtName, evtData);
  };
}

let draggingElement = null;

const props = {
  list: {
    type: Array,
    required: false,
    default: null
  },
  modelValue: {
    type: Array,
    required: false,
    default: null
  },
  itemKey: {
    type: [String, Function],
    required: true
  },
  clone: {
    type: Function,
    default: original => {
      return original;
    }
  },
  tag: {
    type: String,
    default: "div"
  },
  move: {
    type: Function,
    default: null
  },
  componentData: {
    type: Object,
    required: false,
    default: null
  },
  multiDrag: {
    type: Boolean,
    default: false
  },
	selectedClass: {
    type: String,
    default: "sortable-selected"
  },
	multiDragKey: {
    type: String,
    default: null
  },
	avoidImplicitDeselect: {
    type: Boolean,
    default: false
  }
};

const emits = [
  "update:modelValue",
  "change",
  ...[...events.manageAndEmit, ...events.emit].map(evt => evt.toLowerCase())
];

const draggableComponent = defineComponent({
  name: "draggable",

  inheritAttrs: false,

  props,

  emits,

  data() {
    return {
      error: false
    };
  },

  render() {
    try {
      this.error = false;
      const { $slots, $attrs, tag, componentData, realList, getKey } = this;
      const componentStructure = computeComponentStructure({
        $slots,
        tag,
        realList,
        getKey
      });
      this.componentStructure = componentStructure;
      const attributes = getComponentAttributes({ $attrs, componentData });
      return componentStructure.render(h, attributes);
    } catch (err) {
      this.error = true;
      return h("pre", { style: { color: "red" } }, err.stack);
    }
  },

  created() {
    if (this.list !== null && this.modelValue !== null) {
      console.error(
        "modelValue and list props are mutually exclusive! Please set one or another."
      );
    }

    if (this.multiDrag && (this.selectedClass || "") === "") {
      console.warn(
        "selected-class must be set when multi-drag mode. See https://github.com/SortableJS/Sortable/wiki/Dragging-Multiple-Items-in-Sortable#enable-multi-drag"
      );
    }
  },

  mounted() {
    if (this.error) {
      return;
    }

    const { $attrs, $el, componentStructure } = this;
    componentStructure.updated();

    const sortableOptions = createSortableOption({
      $attrs,
      callBackBuilder: {
        manageAndEmit: event => manageAndEmit.call(this, event),
        emit: event => emit.bind(this, event),
        manage: event => manage.call(this, event)
      }
    });
    const targetDomElement = $el.nodeType === 1 ? $el : $el.parentElement;
    if (this.multiDrag) {
      sortableOptions.multiDrag = true;
      sortableOptions.selectedClass = this.selectedClass;
      if (this.multiDragKey) {
        sortableOptions.multiDragKey = this.multiDragKey;
      }
    }
    this._sortable = new Sortable(targetDomElement, sortableOptions);
    this.targetDomElement = targetDomElement;
    targetDomElement.__draggable_component__ = this;
  },

  updated() {
    this.componentStructure.updated();
  },

  beforeUnmount() {
    if (this._sortable !== undefined) this._sortable.destroy();
  },

  computed: {
    realList() {
      const { list } = this;
      return list ? list : this.modelValue;
    },

    getKey() {
      const { itemKey } = this;
      if (typeof itemKey === "function") {
        return itemKey;
      }
      return element => element[itemKey];
    }
  },

  watch: {
    $attrs: {
      handler(newOptionValue) {
        const { _sortable } = this;
        if (!_sortable) return;
        getValidSortableEntries(newOptionValue).forEach(([key, value]) => {
          _sortable.option(key, value);
        });
      },
      deep: true
    }
  },

  methods: {
    getUnderlyingVm(domElement) {
      return this.componentStructure.getUnderlyingVm(domElement) || null;
    },

    getUnderlyingVmList(htmlElts) {
      const list = htmlElts.map(this.getUnderlyingVm);
      return list.filter(e => !!e);
    },

    getUnderlyingPotencialDraggableComponent(htmElement) {
      //TODO check case where you need to see component children
      return htmElement.__draggable_component__;
    },

    emitChanges(evt) {
      nextTick(() => this.$emit("change", evt));
    },

    alterList(onList) {
      if (this.list) {
        onList(this.list);
        return;
      }
      const newList = [...this.modelValue];
      onList(newList);
      this.$emit("update:modelValue", newList);
    },

    spliceList() {
      // @ts-ignore
      const spliceList = list => list.splice(...arguments);
      this.alterList(spliceList);
    },

    updatePosition(oldIndex, newIndex) {
      const updatePosition = list =>
        list.splice(newIndex, 0, list.splice(oldIndex, 1)[0]);
      this.alterList(updatePosition);
    },

    getRelatedContextFromMoveEvent({ to, related }) {
      const component = this.getUnderlyingPotencialDraggableComponent(to);
      if (!component) {
        return { component };
      }
      const list = component.realList;
      const context = { list, component };
      if (to !== related && list) {
        const destination = component.getUnderlyingVm(related) || {};
        return { ...destination, ...context };
      }
      return context;
    },

    getVmIndexFromDomIndex(domIndex) {
      return this.componentStructure.getVmIndexFromDomIndex(
        domIndex,
        this.targetDomElement
      );
    },

    onDragStart(evt) {
      if (evt.items && evt.items.length) {
        this.doDragStartList(evt);
      } else {
        this.doDragStart(evt);
      }
    },

    doDragStart(evt) {
      this.context = this.getUnderlyingVm(evt.item);
      evt.item._underlying_vm_ = this.clone(this.context.element);
      draggingElement = evt.item;
    },

    doDragStartList(evt) {
      this.context = this.getUnderlyingVmList(evt.items);
      evt.item._underlying_vm_ = this.clone(this.context.map(e => e.element));
      draggingElement = evt.item;
    },

    onDragAdd(evt) {
      const element = evt.item._underlying_vm_;
      if (element === undefined) {
        return;
      }
      if (Array.isArray(element)) {
        this.doDragAddList(evt, element);
      } else {
        this.doDragAdd(evt, element);
      }
    },

    doDragAdd(evt, element) {
      removeNode(evt.item);
      const newIndex = this.getVmIndexFromDomIndex(evt.newIndex);
      // @ts-ignore
      this.spliceList(newIndex, 0, element);
      const added = { element, newIndex };
      this.emitChanges({ added });
    },

    doDragAddList(evt, elements) {
      if (elements.length === 0) {
        return;
      }
      evt.items.forEach(removeNode);
      const newIndexFrom = this.getVmIndex(evt.newIndex);
      this.alterList(list => list.splice(newIndexFrom, 0, ...elements));
      const added = elements.map((element, index) => {
        const newIndex = newIndexFrom + index;
        return { element, newIndex };
      });
      this.computeIndexes();
      this.emitChanges({ added });
    },

    onDragRemove(evt) {
      if (Array.isArray(this.context)) {
        this.doDragRemoveList(evt);
      } else {
        this.doDragRemove(evt);
      }
    },

    doDragRemove(evt) {
      insertNodeAt(this.$el, evt.item, evt.oldIndex);
      if (evt.pullMode === "clone") {
        removeNode(evt.clone);
        return;
      }
      const { index: oldIndex, element } = this.context;
      // @ts-ignore
      this.spliceList(oldIndex, 1);
      const removed = { element, oldIndex };
      this.emitChanges({ removed });
    },

    doDragRemoveList(evt) {
      evt.items.forEach((item, index) => {
        insertNodeAt(this.rootContainer, item, evt.oldIndicies[index].index);
      });
      if (evt.pullMode === "clone") {
        if (evt.clones) {
          evt.clones.forEach(removeNode);
        } else {
          removeNode(evt.clone);
        }
        return;
      }
      const reversed = this.context.sort((a, b) => b.index - a.index);
      const removed = reversed.map(item => {
        const oldIndex = item.index;
        this.resetTransitionData(oldIndex);
        return { element: item.element, oldIndex };
      });
      this.alterList(list => {
        removed.forEach(removedItem => {
          list.splice(removedItem.oldIndex, 1);
        });
      });
      this.computeIndexes();
      this.emitChanges({ removed });
    },

    onDragUpdate(evt) {
      if (Array.isArray(this.context)) {
        this.doDragUpdateList(evt);
      } else {
        this.doDragUpdate(evt);
      }
    },

    doDragUpdate(evt) {
      removeNode(evt.item);
      insertNodeAt(evt.from, evt.item, evt.oldIndex);
      const oldIndex = this.context.index;
      const newIndex = this.getVmIndexFromDomIndex(evt.newIndex);
      this.updatePosition(oldIndex, newIndex);
      const moved = { element: this.context.element, oldIndex, newIndex };
      this.emitChanges({ moved });
    },

    doDragUpdateList(evt) {
      evt.items.forEach((item, index) => {
        const c = this.context[index];
        removeNode(item);
        insertNodeAt(evt.from, item, c.index);
      });
      // eslint-disable-next-line prettier/prettier
      const newIndexFrom = this.getVmIndex(evt.newIndex) - evt.items.indexOf(evt.item);
      const moved = this.context.map((item, index) => {
        const oldIndex = item.index;
        const newIndex = newIndexFrom + index;
        return { element: item.element, oldIndex, newIndex };
      });
      this.alterList(list => {
        const target = moved.slice();
        // remove moved elements from old index
        target.sort((a, b) => b.oldIndex - a.oldIndex);
        target.forEach(e => list.splice(e.oldIndex, 1));
        // add moved elements to new index
        target.sort((a, b) => a.newIndex - b.newIndex);
        target.forEach(e => list.splice(e.newIndex, 0, e.element));
      });
      this.emitChanges({ moved });
    },

    computeFutureIndex(relatedContext, evt) {
      if (!relatedContext.element) {
        return 0;
      }
      const domChildren = [...evt.to.children].filter(
        el => el.style["display"] !== "none"
      );
      const currentDomIndex = domChildren.indexOf(evt.related);
      const currentIndex = relatedContext.component.getVmIndexFromDomIndex(
        currentDomIndex
      );
      const draggedInList = domChildren.indexOf(draggingElement) !== -1;
      return draggedInList || !evt.willInsertAfter
        ? currentIndex
        : currentIndex + 1;
    },

    onDragMove(evt, originalEvent) {
      const { move, realList } = this;
      if (!move || !realList) {
        return true;
      }

      const relatedContext = this.getRelatedContextFromMoveEvent(evt);
      const futureIndex = this.computeFutureIndex(relatedContext, evt);
      const draggedContext = {
        ...this.context,
        futureIndex
      };
      const sendEvent = {
        ...evt,
        relatedContext,
        draggedContext
      };
      return move(sendEvent, originalEvent);
    },

    onDragEnd(evt) {
      evt.items.forEach(Sortable.utils.deselect);
      draggingElement = null;
    }
  }
});

export default draggableComponent;
