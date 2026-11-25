/* main.js
   Entry point. Wires up the top-level, static button/select event handlers
   (the ones tied to page-level actions rather than dynamically-rendered
   content — those delegated handlers live next to their own render logic in
   filters.js / seating-grid.js / register.js) and kicks off the initial
   data load. This file must load LAST, after every other js/seating/*.js
   module, since it calls straight into all of them. */
(function (S) {
  'use strict';

  const dom = S.dom;
  const dataLoader = S.dataLoader;
  const filters = S.filters;
  const seatingGrid = S.seatingGrid;
  const imageExport = S.imageExport;
  const planStorage = S.planStorage;
  const register = S.register;
  const firebaseSync = S.firebaseSync;

  dom.$subject.on('change', filters.filterAndRenderCandidates);
  dom.$concessionFilter.on('change', filters.filterAndRenderCandidates);

  $('#generateBtn').on('click', seatingGrid.generatePlan);
  $('#resetBtn').on('click', seatingGrid.resetGrid);

  $('#previewBtn').on('click', imageExport.previewImage);
  dom.$downloadImgBtn.on('click', imageExport.downloadImage);
  dom.$downloadSingleImgBtn.on('click', imageExport.downloadSingleImage);
  dom.$printImgBtn.on('click', imageExport.printImages);

  $('#downloadJsonBtn').on('click', planStorage.saveJson);
  $('#loadJsonBtn').on('click', () => document.getElementById('loadJsonFile').click());
  $('#loadJsonFile').on('change', function () {
    if (this.files && this.files[0]) planStorage.loadJsonFile(this.files[0]);
    this.value = '';
  });

  $('#cloudSaveBtn').on('click', firebaseSync.saveToCloud);
  $('#refreshCloudBtn').on('click', firebaseSync.refreshCloudList);

  $('#registerPreviewBtn').on('click', register.previewRegister);
  $('#registerPrintBtn').on('click', register.printRegister);
  $('#registerDownloadBtn').on('click', register.downloadRegisterHtml);
  $('#registerModalPrintBtn').on('click', register.printRegister);

  // ===== Init =====
  dataLoader.loadData();
  firebaseSync.refreshCloudList();
})(window.Seating);
