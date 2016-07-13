define([

  "dojo/i18n!./nls/resources",

  "dojo/_base/declare",
  "dojo/_base/kernel",

  "dojo/dom",
  "dojo/dom-attr",
  "dojo/dom-class",

  "esri/Camera",

  "esri/geometry/Point",
  "esri/geometry/SpatialReference",

  "esri/views/SceneView",

  "esri/WebScene",

  "dojo/domReady!"

], function (
  i18n,
  declare, kernel,
  dom, domAttr, domClass,
  Camera,
  Point, SpatialReference,
  SceneView,
  WebScene
) {

  //--------------------------------------------------------------------------
  //
  //  Static Variables
  //
  //--------------------------------------------------------------------------

  var CSS = {
    loading: "app-bp--loading",
    error: "app-bp--error",
    errorIcon: "esri-icon-notice-round"
  };

  var RTL_LANGS = ["ar", "he"];
  var LTR = "ltr";
  var RTL = "rtl";

  return declare(null, {

    //--------------------------------------------------------------------------
    //
    //  Variables
    //
    //--------------------------------------------------------------------------

    boilerplate: null,

    boilerplateResults: null,

    config: null,

    //--------------------------------------------------------------------------
    //
    //  Public Methods
    //
    //--------------------------------------------------------------------------

    init: function (boilerplate) {
      if (boilerplate) {
        this.config = boilerplate.config;
        this.boilerplateResults = boilerplate.results;
        this._setDirection();
        this._createWebscene();
      }
      else {
        var error = new Error("main:: Config is not defined");
        this.reportError(error);
      }
    },

    reportError: function (error) {
      // remove loading class from body
      domClass.remove(document.body, CSS.loading);
      domClass.add(document.body, CSS.error);
      // an error occurred - notify the user. In this example we pull the string from the
      // resource.js file located in the nls folder because we've set the application up
      // for localization. If you don't need to support multiple languages you can hardcode the
      // strings here and comment out the call in index.html to get the localization strings.
      // set message
      var node = dom.byId("loading_message");
      if (node) {
        node.innerHTML = "<h1><span class=\"" + CSS.errorIcon + "\"></span> " + i18n.error + "</h1><p>" + i18n.scene.error + ": " + error.message + "</p>";
      }
      return error;
    },

    //--------------------------------------------------------------------------
    //
    //  Private Methods
    //
    //--------------------------------------------------------------------------

    _setDirection: function () {
      var direction = LTR;
      RTL_LANGS.some(function (l) {
        if (kernel.locale.indexOf(l) !== -1) {
          direction = RTL;
          return true;
        }
        return false;
      });
      var dirNode = document.getElementsByTagName("html")[0];
      domAttr.set(dirNode, "dir", direction);
    },

    _createWebscene: function () {
      var webscene, websceneItem = this.boilerplateResults.websceneItem;
      if (websceneItem.data) {
        webscene = new WebScene({
          portalItem: websceneItem.data
        });
      }
      else if (websceneItem.json) {
        webscene = WebScene.fromJSON(websceneItem.json.itemData);
        webscene.portalItem = websceneItem.json.item;
      }
      if (webscene) {
        var viewProperties = {
          map: webscene,
          container: "viewDiv"
        };
        if (this.config.components) {
          viewProperties.ui = {
            components: this.config.components.split(",")
          };
        }
        var camera = this._setCameraViewpoint();
        if (camera) {
          viewProperties.camera = camera;
        }
        if (!this.config.title && webscene.portalItem && webscene.portalItem.title) {
          this.config.title = webscene.portalItem.title;
        }
        var view = new SceneView(viewProperties);
        view.then(function (response) {
          domClass.remove(document.body, CSS.loading);
          document.title = this.config.title;
        }.bind(this), this.reportError);
      }
    },

    _setCameraViewpoint: function () {
      var viewpointParamString = this.config.viewpoint;
      var viewpointArray = viewpointParamString && viewpointParamString.split(";");
      if (!viewpointArray || !viewpointArray.length) {
        return;
      }
      else {
        var cameraString = "";
        var tiltHeading = "";
        for (var i = 0; i < viewpointArray.length; i++) {
          if (viewpointArray[i].indexOf("cam:") !== -1) {
            cameraString = viewpointArray[i];
          }
          else {
            tiltHeading = viewpointArray[i];
          }
        }
        if (cameraString !== "") {
          cameraString = cameraString.substr(4, cameraString.length - 4);
          var positionArray = cameraString.split(",");
          if (positionArray.length >= 3) {
            var x = 0,
              y = 0,
              z = 0;
            x = parseFloat(positionArray[0]);
            y = parseFloat(positionArray[1]);
            z = parseFloat(positionArray[2]);
            var sr = SpatialReference.WGS84;
            if (positionArray.length === 4) {
              sr = new SpatialReference(parseInt(positionArray[3], 10));
            }
            var cameraPosition = new Point(x, y, z, sr);
            var heading = 0,
              tilt = 0;
            if (tiltHeading !== "") {
              var tiltHeadingArray = tiltHeading.split(",");
              if (tiltHeadingArray.length >= 0) {
                heading = parseFloat(tiltHeadingArray[0]);
                if (tiltHeadingArray.length > 1) {
                  tilt = parseFloat(tiltHeadingArray[1]);
                }
              }
            }
            var camera = new Camera({
              position: cameraPosition,
              heading: heading,
              tilt: tilt
            });
            return camera;
          }
        }
      }
    }
  });
});
