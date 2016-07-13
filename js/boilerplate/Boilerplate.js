define([

  "dojo/text!config/config.json",

  "dojo/_base/kernel",
  "dojo/_base/lang",

  "dojo/Deferred",

  "esri/config",

  "esri/core/Promise",
  "esri/core/promiseList",

  "esri/identity/IdentityManager",
  "esri/identity/OAuthInfo",

  "esri/portal/Portal",
  "esri/portal/PortalItem",
  "esri/portal/PortalQueryParams"

], function (
  applicationConfig,
  kernel, lang,
  Deferred,
  esriConfig,
  Promise, promiseList,
  IdentityManager, OAuthInfo,
  Portal, PortalItem, PortalQueryParams
) {

  //--------------------------------------------------------------------------
  //
  //  Static Variables
  //
  //--------------------------------------------------------------------------

  var TAGS_RE = /<\/?[^>]+>/g;
  var URL_RE = /([^&=]+)=?([^&]*)(?:&+|$)/g;
  var SHARING_PATH = "/sharing";
  var ESRI_PROXY_PATH = "/sharing/proxy";
  var ESRI_APPS_PATH = "/apps/";
  var ESRI_HOME_PATH = "/home/";
  var RTL_LANGS = ["ar", "he"];
  var LTR = "ltr";
  var RTL = "rtl";

  return Promise.createSubclass({

    //--------------------------------------------------------------------------
    //
    //  Properties
    //
    //--------------------------------------------------------------------------

    settings: null,

    config: null,

    results: null,

    portal: null,

    direction: null,

    units: null,

    userPrivileges: null,

    //--------------------------------------------------------------------------
    //
    //  Lifecycle
    //
    //--------------------------------------------------------------------------

    constructor: function (boilerplateSettings) {
      var applicationConfigJSON = JSON.parse(applicationConfig);
      // mixin defaults with boilerplate configuration
      this.settings = lang.mixin({
        "webscene": {},
        "webmap": {},
        "group": {},
        "portal": {},
        "urlItems": []
      }, boilerplateSettings);
      // config will contain application and user defined info for the application such as the web scene id and application id, any url parameters and any application specific configuration information.
      this.config = applicationConfigJSON;
      // stores results from queries
      this.results = {};
      // initialization
      var initPromise = this._init();
      this.addResolvingPromise(initPromise);
    },

    //--------------------------------------------------------------------------
    //
    //  Public Methods
    //
    //--------------------------------------------------------------------------

    queryGroupItems: function (options) {
      var deferred;
      // Get details about the specified web scene. If the web scene is not shared publicly users will
      // be prompted to log-in by the Identity Manager.
      deferred = new Deferred();
      if (!this.settings.group.fetchItems || !this.config.group) {
        deferred.resolve();
      }
      else {
        this.results.group = {};
        var defaultParams = {
          query: "group:\"{groupid}\" AND -type:\"Code Attachment\"",
          sortField: "modified",
          sortOrder: "desc",
          num: 9,
          start: 1
        };
        var paramOptions = lang.mixin(defaultParams, this.settings.group.itemParams, options);
        // place group ID
        if (paramOptions.query) {
          paramOptions.query = lang.replace(paramOptions.query, {
            groupid: this.config.group
          });
        }
        // group params
        var params = new PortalQueryParams(paramOptions);
        this.portal.queryItems(params).then(function (response) {
          this.results.group.itemsData = response;
          deferred.resolve(this.results.group);
        }.bind(this), function (error) {
          if (!error) {
            error = new Error("Error retrieving group items.");
          }
          deferred.reject(error);
        });
      }
      return deferred.promise;
    },

    //--------------------------------------------------------------------------
    //
    //  Private Methods
    //
    //--------------------------------------------------------------------------

    // Get URL parameters and set application defaults needed to query arcgis.com for
    // an application and to see if the app is running in Portal or an Org
    _init: function () {
      // Set the web scene and appid if they exist but ignore other url params.
      // Additional url parameters may be defined by the application but they need to be mixed in
      // to the config object after we retrieve the application configuration info. As an example,
      // we'll mix in some commonly used url parameters after
      // the application configuration has been applied so that the url parameters overwrite any
      // configured settings. It's up to the application developer to update the application to take
      // advantage of these parameters.
      // This demonstrates how to handle additional custom url parameters. For example
      // if you want users to be able to specify lat/lon coordinates that define the map's center or
      // specify an alternate basemap via a url parameter.
      // If these options are also configurable these updates need to be added after any
      // application default and configuration info has been applied. Currently these values
      // (center, basemap, theme) are only here as examples and can be removed if you don't plan on
      // supporting additional url parameters in your application.
      this.results.urlParams = {
        config: this._getUrlParamValues(this.settings.urlItems)
      };
      // config defaults <- standard url params
      // we need the web scene, appid,and oauthappid to query for the data
      this._mixinAllConfigs();
      // Define the portalUrl and other default values like the proxy.
      // The portalUrl defines where to search for the web map and application content. The
      // default value is arcgis.com.
      this._initializeApplication();
      // determine application language direction
      this._setDirection();
      // check if signed in. Once we know if we're signed in, we can get data and create a portal if needed.
      return this._checkSignIn().always(function () {
        // execute these tasks async
        return promiseList({
          // get application data
          applicationItem: this._queryApplicationItem(),
          // get org data
          portal: this._queryPortal()
        }).always(function () {
          // mixin all new settings from org and app
          this._mixinAllConfigs();
          // let's set up a few things
          this._completeApplication();
          // then execute these async
          return promiseList({
            // webmap item
            webmapItem: this._queryWebmapItem(),
            // webscene item
            websceneItem: this._queryWebsceneItem(),
            // group information
            groupInfo: this._queryGroupInfo(),
            // items within a specific group
            groupItems: this.queryGroupItems()
          });
        }.bind(this));
      }.bind(this));
    },

    _queryWebmapItem: function () {
      var deferred;
      // Get details about the specified web scene. If the web scene is not shared publicly users will
      // be prompted to log-in by the Identity Manager.
      deferred = new Deferred();
      if (!this.settings.webmap.fetch) {
        deferred.resolve();
      }
      else {
        this.results.webmapItem = {};
        // Use local web scene instead of portal web scene
        if (this.settings.webmap.useLocal) {
          // get web scene js file
          require(["dojo/text!" + this.settings.webmap.localFile], function (webmapText) {
            // return web scene json
            var json = JSON.parse(webmapText);
            this.results.webmapItem.json = json;
            deferred.resolve(this.results.webmapItem);
          }.bind(this));
        }
        // no web scene is set and we have organization's info
        else if (!this.config.webmap) {
          var defaultWebmap = {
            "item": {
              "title": "Default Webmap",
              "type": "Web Map",
              "description": "A webmap with the default basemap and extent.",
              "snippet": "A webmap with the default basemap and extent."
            },
            "itemData": {
              "operationalLayers": [],
              "baseMap": {
                "baseMapLayers": [{
                  "id": "defaultBasemap",
                  "layerType": "ArcGISTiledMapServiceLayer",
                  "opacity": 1,
                  "visibility": true,
                  "url": "http://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer"
                }],
                "title": "Topographic"
              },
              "spatialReference": {
                "wkid": 102100,
                "latestWkid": 3857
              },
              "version": "2.1"
            }
          };
          this.results.webmapItem.json = defaultWebmap;
          deferred.resolve(this.results.webmapItem);
        }
        // use webmap from id
        else {
          var mapItem = new PortalItem({
            id: this.config.webmap
          }).load();
          mapItem.then(function (itemData) {
            this.results.webmapItem.data = itemData;
            deferred.resolve(this.results.webmapItem);
          }.bind(this), function (error) {
            if (!error) {
              error = new Error("Error retrieving webmap item.");
            }
            deferred.reject(error);
          });
        }
      }
      return deferred.promise;
    },

    _queryGroupInfo: function () {
      var deferred;
      // Get details about the specified web scene. If the web scene is not shared publicly users will
      // be prompted to log-in by the Identity Manager.
      deferred = new Deferred();
      if (!this.settings.group.fetchInfo || !this.config.group) {
        deferred.resolve();
      }
      else {
        this.results.group = {};
        // group params
        var params = new PortalQueryParams({
          query: "id:\"" + this.config.group + "\""
        });
        this.portal.queryGroups(params).then(function (response) {
          this.results.group.infoData = response;
          deferred.resolve(this.results.group);
        }.bind(this), function (error) {
          if (!error) {
            error = new Error("Error retrieving group info.");
          }
          deferred.reject(error);
        });
      }
      return deferred.promise;
    },

    _queryWebsceneItem: function () {
      var deferred, sceneItem;
      // Get details about the specified web scene. If the web scene is not shared publicly users will
      // be prompted to log-in by the Identity Manager.
      deferred = new Deferred();
      if (!this.settings.webscene.fetch) {
        deferred.resolve();
      }
      else {
        this.results.websceneItem = {};
        // Use local web scene instead of portal web scene
        if (this.settings.webscene.useLocal) {
          // get web scene js file
          require(["dojo/text!" + this.settings.webscene.localFile], function (websceneText) {
            // return web scene json
            var json = JSON.parse(websceneText);
            this.results.websceneItem.json = json;
            deferred.resolve(this.results.websceneItem);
          }.bind(this));
        }
        // no web scene is set and we have organization's info
        else if (!this.config.webscene) {
          var defaultWebscene = {
            "item": {
              "title": "Default Webscene",
              "type": "Web Scene",
              "description": "A web scene with the default basemap and extent.",
              "snippet": "A web scene with the default basemap and extent."
            },
            "itemData": {
              "operationalLayers": [],
              "version": "1.3",
              "baseMap": {
                "baseMapLayers": [{
                  "id": "defaultBasemap",
                  "layerType": "ArcGISTiledMapServiceLayer",
                  "opacity": 1,
                  "visibility": true,
                  "url": "http://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer"
                }],
                "title": "Topographic"
              }
            }
          };
          this.results.websceneItem.json = defaultWebscene;
          deferred.resolve(this.results.websceneItem);
        }
        // use webscene from id
        else {
          sceneItem = new PortalItem({
            id: this.config.webscene
          }).load();
          sceneItem.then(function (itemData) {
            this.results.websceneItem.data = itemData;
            deferred.resolve(this.results.websceneItem);
          }.bind(this), function (error) {
            if (!error) {
              error = new Error("Error retrieving webscene item.");
            }
            deferred.reject(error);
          });
        }
      }
      return deferred.promise;
    },

    _queryApplicationItem: function () {
      // Get the application configuration details using the application id. When the response contains
      // itemData.values then we know the app contains configuration information. We'll use these values
      // to overwrite the application defaults.
      var deferred = new Deferred();
      if (!this.config.appid) {
        deferred.resolve();
      }
      else {
        var appItem = new PortalItem({
          id: this.config.appid
        }).load();
        appItem.then(function (itemData) {
          var cfg = {};
          if (itemData && itemData.values) {
            // get app config values - we'll merge them with config later.
            cfg = itemData.values;
          }
          // get the extent for the application item. This can be used to override the default web map extent
          if (itemData.item && itemData.item.extent) {
            cfg.application_extent = itemData.item.extent;
          }
          // get any app proxies defined on the application item
          if (itemData.item && itemData.item.appProxies) {
            var layerMixins = itemData.item.appProxies.map(function (p) {
              return {
                "url": p.sourceUrl,
                "mixin": {
                  "url": p.proxyUrl
                }
              };
            });
            cfg.layerMixins = layerMixins;
          }
          this.results.applicationItem = {
            data: itemData,
            config: cfg
          };
          deferred.resolve(this.results.applicationItem);
        }.bind(this), function (error) {
          if (!error) {
            error = new Error("Error retrieving application configuration.");
          }
          deferred.reject(error);
        });
      }
      return deferred.promise;
    },

    _queryPortal: function () {
      var deferred = new Deferred();
      if (!this.settings.portal.fetch) {
        deferred.resolve();
      }
      else {
        // Query the ArcGIS.com organization. This is defined by the portalUrl that is specified. For example if you
        // are a member of an org you'll want to set the portalUrl to be http://<your org name>.arcgis.com. We query
        // the organization by making a self request to the org url which returns details specific to that organization.
        // Examples of the type of information returned are custom roles, units settings, helper services and more.
        // If this fails, the application will continue to function
        var portal = new Portal().load();
        this.portal = portal;
        portal.then(function (response) {
          if (this.settings.webTierSecurity) {
            var trustedHost;
            if (response.authorizedCrossOriginDomains && response.authorizedCrossOriginDomains.length > 0) {
              for (var i = 0; i < response.authorizedCrossOriginDomains.length; i++) {
                trustedHost = response.authorizedCrossOriginDomains[i];
                // add if trusted host is not null, undefined, or empty string
                if (this._isDefined(trustedHost) && trustedHost.length > 0) {
                  esriConfig.request.corsEnabledServers.push({
                    host: trustedHost,
                    withCredentials: true
                  });
                }
              }
            }
          }
          // set boilerplate units
          var units = "metric";
          if (response.user && response.user.units) { //user defined units
            units = response.user.units;
          }
          else if (response.units) { //org level units
            units = response.units;
          }
          else if ((response.user && response.user.region && response.user.region === "US") || (response.user && !response.user.region && response.region === "US") || (response.user && !response.user.region && !response.region) || (!response.user && response.ipCntryCode === "US") || (!response.user && !response.ipCntryCode && kernel.locale === "en-us")) {
            // use feet/miles only for the US and if nothing is set for a user
            units = "english";
          }
          this.units = units;
          // are any custom roles defined in the organization?
          if (response.user && this._isDefined(response.user.roleId)) {
            if (response.user.privileges) {
              this.userPrivileges = response.user.privileges;
            }
          }
          // set data for portal on boilerplate
          this.results.portal = {
            data: response
          };
          deferred.resolve(this.results.portal);
        }.bind(this), function (error) {
          if (!error) {
            error = new Error("Error retrieving organization information.");
          }
          deferred.reject(error);
        });
      }
      return deferred.promise;
    },

    _overwriteExtent: function (itemInfo, extent) {
      var item = itemInfo && itemInfo.item;
      if (item && item.extent) {
        item.extent = [
          [
            parseFloat(extent[0][0]), parseFloat(extent[0][1])
          ],
          [
            parseFloat(extent[1][0]), parseFloat(extent[1][1])
          ]
        ];
      }
    },

    _completeApplication: function () {
      // ArcGIS.com allows you to set an application extent on the application item. Overwrite the
      // existing extents with the application item extent when set.
      var applicationExtent = this.config.application_extent;
      var results = this.results;
      if (this.config.appid && applicationExtent && applicationExtent.length > 0) {
        this._overwriteExtent(results.websceneItem.data, applicationExtent);
        this._overwriteExtent(results.webmapItem.data, applicationExtent);
      }
      // get helper services
      var configHelperServices = this.config.helperServices;
      var portalHelperServices = this.portal && this.portal.helperServices;
      // see if config has a geometry service
      var configGeometryUrl = configHelperServices && configHelperServices.geometry && configHelperServices.geometry.url;
      // seee if portal has a geometry service
      var portalGeometryUrl = portalHelperServices && portalHelperServices.geometry && portalHelperServices.geometry.url;
      // use the portal geometry service or config geometry service
      var geometryUrl = portalGeometryUrl || configGeometryUrl;
      if (geometryUrl) {
        // set the esri config to use the geometry service
        esriConfig.geometryServiceUrl = geometryUrl;
      }
    },

    // determine appropriate language direction for the application
    _setDirection: function () {
      var direction = LTR;
      RTL_LANGS.some(function (l) {
        if (kernel.locale.indexOf(l) !== -1) {
          direction = RTL;
          return true;
        }
        return false;
      });
      this.direction = direction;
    },

    _mixinAllConfigs: function () {
      /*
      mix in all the settings we got!
      config <- application settings <- url params
      */
      lang.mixin(
        this.config,
        this.results.applicationItem ? this.results.applicationItem.config : null,
        this.results.urlParams ? this.results.urlParams.config : null
      );
    },

    _getUrlParamValues: function (items) {
      // retrieves only the items specified from the URL object.
      // Gets parameters from the URL, convert them to an object and remove HTML tags.
      var urlObject = this._createUrlParamsObject();
      var obj = {};
      if (urlObject && items && items.length) {
        for (var i = 0; i < items.length; i++) {
          var item = urlObject[items[i]];
          if (item) {
            if (typeof item === "string") {
              switch (item.toLowerCase()) {
                case "true":
                  obj[items[i]] = true;
                  break;
                case "false":
                  obj[items[i]] = false;
                  break;
                default:
                  obj[items[i]] = item;
              }
            }
            else {
              obj[items[i]] = item;
            }
          }
        }
      }
      return obj;
    },

    _createUrlParamsObject: function () {
      // retrieve url parameters. Templates all use url parameters to determine which arcgis.com
      // resource to work with.
      // Scene templates use the webscene param to define the scene to display
      // appid is the id of the application based on the template. We use this
      // id to retrieve application specific configuration information. The configuration
      // information will contain the values the  user selected on the template configuration
      // panel.
      return this._stripTags(this._urlToObject());
    },

    _initializeApplication: function () {
      // If this app is hosted on an Esri environment.
      if (this.settings.esriEnvironment) {
        var appLocation, instance;
        // Check to see if the app is hosted or a portal. If the app is hosted or a portal set the
        // portalUrl and the proxy. Otherwise use the portalUrl set it to arcgis.com.
        // We know app is hosted (or portal) if it has /apps/ or /home/ in the url.
        appLocation = location.pathname.indexOf(ESRI_APPS_PATH);
        if (appLocation === -1) {
          appLocation = location.pathname.indexOf(ESRI_HOME_PATH);
        }
        // app is hosted and no portalUrl is defined so let's figure it out.
        if (appLocation !== -1) {
          // hosted or portal
          instance = location.pathname.substr(0, appLocation); //get the portal instance name
          this.config.portalUrl = "https://" + location.host + instance;
          this.config.proxyUrl = "https://" + location.host + instance + ESRI_PROXY_PATH;
        }
      }
      esriConfig.portalUrl = this.config.portalUrl;
      // Define the proxy url for the app
      if (this.config.proxyUrl) {
        esriConfig.request.proxyUrl = this.config.proxyUrl;
      }
    },

    // check if user is signed into a portal
    _checkSignIn: function () {
      var deferred, signedIn, oAuthInfo;
      deferred = new Deferred();
      //If there's an oauth appid specified register it
      if (this.config.oauthappid) {
        oAuthInfo = new OAuthInfo({
          appId: this.config.oauthappid,
          portalUrl: this.config.portalUrl,
          popup: true
        });
        IdentityManager.registerOAuthInfos([oAuthInfo]);
      }
      // check sign-in status
      signedIn = IdentityManager.checkSignInStatus(this.config.portalUrl + SHARING_PATH);
      // resolve regardless of signed in or not.
      signedIn.always(deferred.resolve);
      return deferred.promise;
    },

    // helper function for determining if a value is defined
    _isDefined: function (value) {
      return (value !== undefined) && (value !== null);
    },

    // remove HTML tags from values
    _stripTags: function (data) {
      if (data) {
        // get type of data
        var t = typeof data;
        if (t === "string") {
          // remove tags from a string
          data = data.replace(TAGS_RE, "");
        }
        else if (t === "object") {
          // remove tags from an object
          for (var item in data) {
            if (data[item]) {
              var currentItem = data[item];
              if (typeof currentItem === "string") {
                //strip html tags
                currentItem = currentItem.replace(TAGS_RE, "");
              }
              // set item back on data
              data[item] = currentItem;
            }
          }
        }
      }
      return data;
    },

    // capture all url params to an object with values
    _urlToObject: function () {
      var query = (window.location.search || "?").substr(1),
        map = {};
      query.replace(URL_RE, function (match, key, value) {
        map[key] = value;
      });
      return map;
    }
  });
});
