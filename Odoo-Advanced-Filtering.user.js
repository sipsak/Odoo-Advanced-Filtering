// ==UserScript==
// @name           Odoo Advanced Filtering
// @name:tr        Odoo Gelişmiş Filtreleme
// @namespace      https://github.com/sipsak
// @version        1.0
// @description    Adds Excel-like column header filtering feature to tables in Odoo
// @description:tr Odoo'da tablolara Excel benzeri sütun başlığından filtreleme yapma özelliği ekler
// @author         Burak Şipşak
// @match          https://portal.bskhvac.com.tr/*
// @match          https://*.odoo.com/*
// @grant          none
// @run-at         document-idle
// @icon           https://raw.githubusercontent.com/sipsak/odoo-image-enlarger/refs/heads/main/icon.png
// @updateURL      https://raw.githubusercontent.com/sipsak/Odoo-Advanced-Filtering/main/Odoo-Advanced-Filtering.user.js
// @downloadURL    https://raw.githubusercontent.com/sipsak/Odoo-Advanced-Filtering/main/Odoo-Advanced-Filtering.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const config = {
        refreshInterval: 2000, // Check for new tables every 2 seconds
        filterIconClass: 'odoo-excel-filter-icon',
        filterMenuClass: 'odoo-excel-filter-menu',
        filterActiveClass: 'odoo-excel-filter-active',
        tableSelector: '.o_list_renderer table.o_list_table'
    };

    // Store references to processed tables and filter states
    const state = {
        processedTables: new WeakSet(),
        activeFilters: new Map(), // Maps table -> column -> filter values
        filterMenuOpen: null, // Currently open filter menu
        columnFilterValues: new Map() // Sütun bazında son filtre penceresinde gösterilen değerleri saklar
    };

    // Styles for the filter components
    const styles = `
        .${config.filterIconClass} {
            margin-left: 5px;
            cursor: pointer;
            color: #999;
            display: none;
            vertical-align: middle;
            float: right !important;
            position: relative;
            z-index: 1;
        }

        .${config.filterIconClass}.${config.filterActiveClass} {
            color: #714B67;
            display: inline-block;
        }

        th:hover .${config.filterIconClass} {
            display: inline-block;
        }

        .${config.filterMenuClass} {
            position: absolute;
            background: white;
            border: 1px solid #ccc;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            z-index: 1000;
            max-height: 400px;
            overflow-y: auto;
            min-width: 250px;
            border-radius: 4px;
        }

        .${config.filterMenuClass} .filter-header {
            padding: 8px 12px;
            border-bottom: 1px solid #eee;
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .${config.filterMenuClass} .filter-footer {
            padding: 8px 12px;
            border-top: 1px solid #eee;
            display: flex;
            justify-content: space-between;
        }

        .${config.filterMenuClass} .filter-option {
            padding: 6px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
        }

        .${config.filterMenuClass} .filter-option label {
            margin-left: 8px;
            cursor: pointer;
        }

        .${config.filterMenuClass} .form-check {
            width: 100%;
            cursor: pointer;
        }

        .${config.filterMenuClass} .filter-option:hover {
            background-color: #f6f6f6;
        }

        .${config.filterMenuClass} .filter-search {
            padding: 8px 12px;
            border-bottom: 1px solid #eee;
        }

        .${config.filterMenuClass} #reset-filter {
            margin-left: 0;
        }

        .${config.filterMenuClass} .filter-options {
            max-height: 250px;
            overflow-y: auto;
        }
    `;

    // Add styles to the page
    function addStyles() {
        const styleElement = document.createElement('style');
        styleElement.textContent = styles;
        document.head.appendChild(styleElement);
    }

    // Detect if an element is an Odoo table
    function isOdooTable(element) {
        return element.matches(config.tableSelector);
    }

    // Process all tables found in the document
    function processAllTables() {
        const tables = document.querySelectorAll(config.tableSelector);
        tables.forEach(table => {
            if (!state.processedTables.has(table)) {
                processTable(table);
                state.processedTables.add(table);
            }
        });
    }

    // Process a single table to add filter capability
    function processTable(table) {
        const headerRow = table.querySelector('thead tr');
        if (!headerRow) return;

        const headerCells = headerRow.querySelectorAll('th');
        headerCells.forEach((cell, index) => {
            // Skip sequence, action columns and empty headers
            if (cell.classList.contains('o_handle_cell') ||
                cell.classList.contains('o_list_controller') ||
                cell.classList.contains('o_list_record_selector') ||
                !cell.textContent.trim()) {
                return;
            }

            addFilterToHeader(cell, table, index);
            // Sıralama özelliği kaldırıldı
        });
    }

    // Add filter icon to a header cell
    function addFilterToHeader(headerCell, table, columnIndex) {
        // Create filter icon if it doesn't exist
        if (!headerCell.querySelector(`.${config.filterIconClass}`)) {
            const columnName = headerCell.getAttribute('data-name');
            if (!columnName) return;

            const filterIcon = document.createElement('i');
            filterIcon.className = `fa fa-filter ${config.filterIconClass}`;
            filterIcon.setAttribute('data-column', columnName);
            filterIcon.setAttribute('data-column-index', columnIndex);

            // Add custom styling to ensure the icon appears at the right side
            filterIcon.style.marginLeft = '4px';
            filterIcon.style.float = 'right';
            filterIcon.style.position = 'relative';
            filterIcon.style.zIndex = '1';

            // Add the filter icon to the header
            const headerContent = headerCell.querySelector('.d-flex');
            if (headerContent) {
                // Force the icon to be at the end, regardless of the flex direction
                headerContent.appendChild(filterIcon);

                // Make sure headerContent has position relative to contain absolutely positioned icons
                if (window.getComputedStyle(headerContent).position === 'static') {
                    headerContent.style.position = 'relative';
                }
            } else {
                headerCell.appendChild(filterIcon);

                // For headers without d-flex, also ensure proper positioning
                if (window.getComputedStyle(headerCell).position === 'static') {
                    headerCell.style.position = 'relative';
                }
            }

            // Add click event to the filter icon
            filterIcon.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleFilterMenu(filterIcon, table, columnName, columnIndex);
            });
        }
    }

    // Toggle the filter menu for a column
    function toggleFilterMenu(filterIcon, table, columnName, columnIndex) {
        // If the same filter menu is already open, close it and return
        if (state.filterMenuOpen &&
            state.filterMenuOpen.getAttribute('data-column') === columnName) {
            closeOpenFilterMenu();
            return;
        }

        // Close any open filter menu
        closeOpenFilterMenu();

        // Create and show the filter menu
        const filterMenu = createFilterMenu(table, columnName, columnIndex);

        // Store column name in menu for later comparison
        filterMenu.setAttribute('data-column', columnName);

        // Position the menu below the filter icon
        const iconRect = filterIcon.getBoundingClientRect();
        filterMenu.style.top = `${iconRect.bottom + window.scrollY}px`;

        // Add the menu to the document so we can measure its width
        document.body.appendChild(filterMenu);

        // Calculate menu width and position dynamically (left or right alignment)
        const menuWidth = filterMenu.offsetWidth;
        const windowWidth = window.innerWidth;
        const iconLeft = iconRect.left + window.scrollX;

        // Check if menu would extend beyond right edge of the window
        if (iconLeft + menuWidth > windowWidth - 20) { // 20px buffer from edge
            // Align the menu to the right edge of the icon
            filterMenu.style.left = `${iconLeft - menuWidth + iconRect.width}px`;
        } else {
            // Default position (left-aligned with the icon)
            filterMenu.style.left = `${iconLeft}px`;
        }

        // Set this as the open filter menu
        state.filterMenuOpen = filterMenu;

        // Close the menu when clicking outside
        setTimeout(() => {
            document.addEventListener('click', handleOutsideClick);
        }, 0);
    }

    // Handle clicks outside the filter menu
    function handleOutsideClick(event) {
        if (state.filterMenuOpen && !state.filterMenuOpen.contains(event.target)) {
            // If clicking on the same filter icon that opened the menu, close it
            if (event.target.classList.contains(config.filterIconClass) &&
                event.target.getAttribute('data-column') === state.filterMenuOpen.getAttribute('data-column')) {
                closeOpenFilterMenu();
            }
            // If clicking anywhere else outside the menu (and not on the same filter icon), close it
            else if (!event.target.classList.contains(config.filterIconClass)) {
                closeOpenFilterMenu();
            }
        }
    }

    // Close the currently open filter menu
    function closeOpenFilterMenu() {
        if (state.filterMenuOpen) {
            state.filterMenuOpen.remove();
            state.filterMenuOpen = null;
            document.removeEventListener('click', handleOutsideClick);
        }
    }

    // Create the filter menu for a column
    function createFilterMenu(table, columnName, columnIndex) {
        const filterMenu = document.createElement('div');
        filterMenu.className = config.filterMenuClass;

        // Get table ID
        const tableId = table.closest('.o_list_view')?.dataset.id || '';
        const activeFilters = state.activeFilters.get(tableId) || {};

        // Excel davranışını taklit et:
        // 1. Hiç filtreleme yoksa, tüm değerleri göster
        // 2. Bu sütun filtrelenmişse, en son filtre penceresinde gözüken TÜM değerleri göster (işaretli ve işaretsiz)
        // 3. Bu sütun filtrelenmemiş ama başka sütunlar filtrelenmişse, sadece görünür değerleri göster
        let uniqueValues;

        if (activeFilters.hasOwnProperty(columnName)) {
            // Bu sütun zaten filtrelenmişse, son filtre penceresinde gözüken tüm değerleri göster
            // Bunu state.columnFilterValues'da tutacağız

            // Eğer bu sütunun değerleri daha önce state'e kaydedilmişse, onları kullan
            if (state.columnFilterValues.has(columnName)) {
                uniqueValues = state.columnFilterValues.get(columnName);
            } else {
                // Eğer state'de yoksa, görünür değerleri al (ilk kez filtreleme yapılıyorsa)
                uniqueValues = getVisibleUniqueColumnValues(table, columnIndex);
                // Ve bu değerleri ileride kullanmak üzere state'e kaydet
                state.columnFilterValues.set(columnName, uniqueValues);
            }
        } else if (Object.keys(activeFilters).length > 0) {
            // Bu sütun filtrelenmemiş ama başka sütunlar filtrelenmişse, sadece görünür değerleri göster
            uniqueValues = getVisibleUniqueColumnValues(table, columnIndex);
        } else {
            // Hiç filtre yoksa, tüm değerleri göster
            uniqueValues = getAllUniqueColumnValues(table, columnIndex);
        }

        // Get current filter for this column if it exists
        const columnFilter = activeFilters[columnName] || [];

        // Create filter menu content
        const header = document.createElement('div');
        header.className = 'filter-header';
        header.innerHTML = `
            <span>${getColumnDisplayName(table, columnIndex)} alanına göre filtrele</span>
            <i class="fa fa-times" id="close-filter-menu"></i>
        `;

        const searchBox = document.createElement('div');
        searchBox.className = 'filter-search';
        searchBox.innerHTML = `
            <div class="o_field_widget o_field_char oe_inline" style="display: block; width: 100%;">
                <input class="o_input" type="text" autocomplete="off" placeholder="Ara..." id="filter-search-input">
            </div>
        `;

        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'filter-options';

        // Select all option
        const selectAllOption = document.createElement('div');
        selectAllOption.className = 'filter-option';

        // "Tümünü seç" onay kutusu durumu:
        // 1. Eğer bu sütun filtreli değilse ve hiç filtre yoksa - işaretli
        // 2. Eğer bu sütun filtreli değilse ama başka filtreler varsa - görünür değerlerin hepsi işaretli ise işaretli
        // 3. Eğer bu sütun filtreli ve tüm değerler seçiliyse - işaretli
        // 4. Eğer bu sütun filtreli ve bazı değerler seçiliyse - işaretsiz
        // 5. Eğer bu sütun filtreli ve hiçbir değer seçili değilse - işaretsiz
        let allChecked = true;

        if (activeFilters.hasOwnProperty(columnName)) {
            // Bu sütun filtrelenmişse
            if (columnFilter.length === 0) {
                // Hiçbir değer seçili değil
                allChecked = false;
            } else if (columnFilter.length === uniqueValues.length) {
                // Tüm değerler seçili
                allChecked = true;
            } else {
                // Bazı değerler seçili
                allChecked = false;
            }
        } else if (Object.keys(activeFilters).length > 0) {
            // Başka sütunlar filtrelenmişse
            // Görünür değerler listesini al
            const visibleValues = getVisibleUniqueColumnValues(table, columnIndex);

            // Eğer tüm görünür değerler, filtreleme penceresinde gösterilen değerlerle aynıysa (sayıca)
            // ve bu değerlerin tümü seçiliyse, "Tümünü seç" işaretli olmalı
            allChecked = visibleValues.length === uniqueValues.length;
        }

        selectAllOption.innerHTML = `
            <div class="form-check">
                <input class="form-check-input" type="checkbox" id="select-all" ${allChecked ? 'checked' : ''}>
                <label class="form-check-label" for="select-all">(Tümünü seç)</label>
            </div>
        `;
        optionsContainer.appendChild(selectAllOption);

        // Individual value options
        uniqueValues.forEach((value, i) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'filter-option';

            // Değer onay kutuları durumu:
            // 1. Eğer sütunda filtre yoksa ve başka sütunlarda da filtre yoksa - işaretli
            // 2. Eğer sütunda filtre yoksa ama başka sütunlarda filtre varsa - sadece görünür satırlardaki değerler işaretli
            // 3. Eğer sütunda filtre varsa - sadece izin verilen değerler işaretli
            let isChecked = true;

            if (activeFilters.hasOwnProperty(columnName)) {
                // Bu sütunda filtre varsa, sadece filtrede izin verilen değerler işaretli olmalı
                isChecked = columnFilter.includes(value);
            } else if (Object.keys(activeFilters).length > 0) {
                // Başka sütunlarda filtre varsa, sadece görünür satırlardaki değerler işaretli olmalı
                const visibleValues = getVisibleUniqueColumnValues(table, columnIndex);
                isChecked = visibleValues.includes(value);
            }

            const displayValue = value === '' ? '(Boş)' : value;
            optionDiv.innerHTML = `
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="option-${i}" value="${value}" ${isChecked ? 'checked' : ''}>
                    <label class="form-check-label" for="option-${i}">${displayValue}</label>
                </div>
            `;
            optionsContainer.appendChild(optionDiv);
        });

        const footer = document.createElement('div');
        footer.className = 'filter-footer';
        footer.innerHTML = `
            <div></div>
            <div>
                <button id="cancel-filter" class="btn btn-secondary">İptal</button>
                <button id="reset-filter" class="btn btn-info">Sıfırla</button>
                <button id="apply-filter" class="btn btn-primary">Uygula</button>
            </div>
        `;

        filterMenu.appendChild(header);
        filterMenu.appendChild(searchBox);
        filterMenu.appendChild(optionsContainer);
        filterMenu.appendChild(footer);

        // Add event listeners
        filterMenu.querySelector('#close-filter-menu').addEventListener('click', () => {
            closeOpenFilterMenu();
        });

        filterMenu.querySelector('#cancel-filter').addEventListener('click', () => {
            closeOpenFilterMenu();
        });

        filterMenu.querySelector('#reset-filter').addEventListener('click', () => {
            // "Sıfırla" butonu basıldığında, bu sütunun filtresini tamamen kaldır
            // Get table ID
            const tableContainer = table.closest('.o_list_view');
            let tableId = tableContainer?.dataset.id;
            if (!tableId) {
                tableId = 'table_' + Math.random().toString(36).substr(2, 9);
                if (tableContainer) tableContainer.dataset.id = tableId;
            }

            // Sütunu filtrelerden kaldır (tamamen)
            if (state.activeFilters.has(tableId)) {
                const tableFilters = state.activeFilters.get(tableId);
                if (tableFilters[columnName]) {
                    delete tableFilters[columnName];
                }
                // Filtre simgesini pasif duruma getir
                updateFilterIconState(table, columnName, false);
                // Filtre değerlerini state'den kaldır
                state.columnFilterValues.delete(columnName);
            }

            // Diğer tüm aktif filtreleri uygula
            applyAllFilters(table, tableId);
            closeOpenFilterMenu();
        });

        filterMenu.querySelector('#apply-filter').addEventListener('click', () => {
            const checkedValues = [];
            const checkboxes = optionsContainer.querySelectorAll('input[type="checkbox"]:not(#select-all)');
            const selectAllCheckbox = filterMenu.querySelector('#select-all');

            checkboxes.forEach(checkbox => {
                if (checkbox.checked) {
                    checkedValues.push(checkbox.value);
                }
            });

            // Hiçbir değer seçili değilse "Tümünü seç" işaretli olmamalı
            if (checkedValues.length === 0) {
                selectAllCheckbox.checked = false;
            } else if (checkedValues.length === checkboxes.length) {
                // Tüm değerler seçiliyse "Tümünü seç" işaretli olmalı
                selectAllCheckbox.checked = true;
            } else {
                // Bazı değerler seçiliyse "Tümünü seç" işaretsiz olmalı
                selectAllCheckbox.checked = false;
            }

            applyFilter(table, columnName, columnIndex, checkedValues);
            closeOpenFilterMenu();
        });

        const selectAllCheckbox = filterMenu.querySelector('#select-all');
        selectAllCheckbox.addEventListener('change', () => {
            const checkboxes = optionsContainer.querySelectorAll('input[type="checkbox"]:not(#select-all)');
            checkboxes.forEach(checkbox => {
                checkbox.checked = selectAllCheckbox.checked;
            });
        });

        // İlk seçim kontrolü - eğer hiçbiri seçili değilse "Tümünü seç" işaretsiz olmalı
        const updateSelectAllState = () => {
            const checkboxes = optionsContainer.querySelectorAll('input[type="checkbox"]:not(#select-all)');
            const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;

            if (checkedCount === 0) {
                selectAllCheckbox.checked = false;
            } else if (checkedCount === checkboxes.length) {
                selectAllCheckbox.checked = true;
            } else {
                selectAllCheckbox.checked = false;
            }
        };

        // Her onay kutusuna kendi değiştiğinde "Tümünü seç" onay kutusunu güncelleyen olay dinleyicisi ekle
        optionsContainer.querySelectorAll('input[type="checkbox"]:not(#select-all)').forEach(checkbox => {
            checkbox.addEventListener('change', updateSelectAllState);
        });

        // Filtre seçeneklerine tıklama işlevselliği ekle (checkbox dışındaki alanlara da tıklanabilsin)
        optionsContainer.querySelectorAll('.filter-option').forEach(option => {
            option.addEventListener('click', (event) => {
                // Eğer direkt olarak checkbox'a tıklandıysa, zaten checkbox'ın kendi işleyicisi çalışacak
                // Bu yüzden sadece başka bir yere tıklandıysa işlem yap
                if (event.target.type !== 'checkbox') {
                    const checkbox = option.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        // change olayını tetikle ki "Tümünü seç" durumu güncellensin
                        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            });
        });

        const filterSearchInput = filterMenu.querySelector('#filter-search-input');
        filterSearchInput.addEventListener('input', () => {
            const searchText = filterSearchInput.value.toLowerCase();
            const options = optionsContainer.querySelectorAll('.filter-option:not(:first-child)');

            options.forEach(option => {
                const label = option.querySelector('label');
                const text = label.textContent.toLowerCase();
                option.style.display = text.includes(searchText) ? '' : 'none';
            });
        });

        return filterMenu;
    }

    // Get the display name of a column
    function getColumnDisplayName(table, columnIndex) {
        const headerCell = table.querySelector(`thead tr th:nth-child(${columnIndex + 1})`);
        if (!headerCell) return '';

        // Try to extract the text content from the span within the header
        const span = headerCell.querySelector('.d-flex span');
        if (span) {
            return span.textContent.trim();
        }

        return headerCell.textContent.trim();
    }

    // Bir satırın "Satır Ekle" satırı veya boş satır olup olmadığını kontrol eder
    function isSpecialRow(row) {
        // "Satır Ekle" satırlarını kontrol et
        const firstCell = row.querySelector('td');
        if (firstCell && firstCell.textContent.trim() === 'Satır Ekle') {
            return true;
        }

        // Tamamen boş satırları kontrol et
        const allCells = Array.from(row.querySelectorAll('td'));
        const allEmpty = allCells.every(cell => !cell.textContent.trim());
        if (allEmpty) {
            return true;
        }

        return false;
    }

    // Get all unique values for a table column (ignoring filters, like Excel)
    function getAllUniqueColumnValues(table, columnIndex) {
        const uniqueValues = new Set();
        // Tüm normal satırları al, özel satırları (Satır Ekle veya tamamen boş) hariç tut
        const rows = Array.from(table.querySelectorAll('tbody tr.o_data_row')).filter(row => !isSpecialRow(row));

        rows.forEach(row => {
            const cell = row.querySelector(`td:nth-child(${columnIndex + 1})`);
            if (cell) {
                const value = cell.getAttribute('data-tooltip') || cell.textContent.trim();
                uniqueValues.add(value);
            }
        });

        return Array.from(uniqueValues).sort((a, b) => {
            // Sort numerically if both values are numbers
            const numA = parseFloat(a.replace(/,/g, ''));
            const numB = parseFloat(b.replace(/,/g, ''));

            if (!isNaN(numA) && !isNaN(numB)) {
                return numA - numB;
            }

            // Otherwise sort alphabetically
            return a.localeCompare(b);
        });
    }

    // Get unique values only from visible rows for a specific column (used for second-level filtering)
    function getVisibleUniqueColumnValues(table, columnIndex) {
        const uniqueValues = new Set();
        // Sadece görünür ve normal satırları al (Satır Ekle ve boş satırlar hariç)
        const rows = Array.from(table.querySelectorAll('tbody tr.o_data_row')).filter(row => {
            // Görünmeyen satırları atla
            if (window.getComputedStyle(row).display === 'none') return false;

            // Özel satırları atla (Satır Ekle ve boş satırlar)
            if (isSpecialRow(row)) return false;

            return true;
        });

        rows.forEach(row => {
            const cell = row.querySelector(`td:nth-child(${columnIndex + 1})`);
            if (cell) {
                const value = cell.getAttribute('data-tooltip') || cell.textContent.trim();
                uniqueValues.add(value);
            }
        });

        return Array.from(uniqueValues).sort((a, b) => {
            // Sort numerically if both values are numbers
            const numA = parseFloat(a.replace(/,/g, ''));
            const numB = parseFloat(b.replace(/,/g, ''));

            if (!isNaN(numA) && !isNaN(numB)) {
                return numA - numB;
            }

            // Otherwise sort alphabetically
            return a.localeCompare(b);
        });
    }

    // Eski getUniqueColumnValues fonksiyonu - sadece uyumluluk için
    function getUniqueColumnValues(table, columnIndex) {
        return getAllUniqueColumnValues(table, columnIndex);
    }

    // Apply a filter to a table
    function applyFilter(table, columnName, columnIndex, allowedValues) {
        // Get table ID or generate one if it doesn't exist
        const tableContainer = table.closest('.o_list_view');
        let tableId = tableContainer?.dataset.id;
        if (!tableId) {
            tableId = 'table_' + Math.random().toString(36).substr(2, 9);
            if (tableContainer) tableContainer.dataset.id = tableId;
        }

        // Initialize filters for this table if they don't exist
        if (!state.activeFilters.has(tableId)) {
            state.activeFilters.set(tableId, {});
        }

        const tableFilters = state.activeFilters.get(tableId);

        // Tüm değerler izin veriliyorsa, bu sütunun filtresini temizle
        const allPossibleValues = getAllUniqueColumnValues(table, columnIndex);
        if (allowedValues.length === allPossibleValues.length) {
            delete tableFilters[columnName];
            // Icon durumunu pasif olarak güncelle
            updateFilterIconState(table, columnName, false);
            // Filtreleme durumunu state'den kaldır
            state.columnFilterValues.delete(columnName);
        } else if (allowedValues.length === 0) {
            // Hiçbir değer seçili değilse, boş bir filtre dizisi ekle
            // Bu, "tüm değerler gizli" anlamına gelir
            tableFilters[columnName] = [];
            updateFilterIconState(table, columnName, true);
        } else {
            // Belirli değerler için filtre uygula
            tableFilters[columnName] = allowedValues;
            updateFilterIconState(table, columnName, true);

            // Excel'in davranışını taklit etmek için, filtre penceresinde gösterilen tüm değerleri state'e kaydet
            // Bu, daha sonra filtre penceresini açtığımızda, o sütun için aynı değerleri göstermek için kullanılacak
            // Bu değerleri getVisibleUniqueColumnValues ile alıyoruz, ANCAK filtrelemeden ÖNCE almalıyız
            // Bu yüzden filtreyi uygulamadan önce mevcut görünür değerleri state'e kaydedeceğiz

            // Filtreleme sonrası bu sütun için filtre penceresinde gösterilecek değerleri state'e kaydet
            if (!state.columnFilterValues.has(columnName)) {
                // İlk filtreleme için, şu anda görünür olan tüm değerleri kaydet
                state.columnFilterValues.set(columnName, getVisibleUniqueColumnValues(table, columnIndex));
            }
            // Not: Eğer zaten state'de bu sütun için değerler varsa, onları güncelleme - çünkü biz Excel gibi davranmak istiyoruz
            // Excel, ilk filtrelemede hangi değerleri gösterdiyse, o sütun için filtreleme yapılırken hep aynı değerleri gösterir
        }

        // Apply all filters to the table
        applyAllFilters(table, tableId);
    }

    // Apply all active filters to a table
    function applyAllFilters(table, tableId) {
        const tableFilters = state.activeFilters.get(tableId) || {};
        const hasActiveFilters = Object.keys(tableFilters).length > 0;

        // Tüm satırları gizlemek/göstermek yerine, her satırın görünürlüğünü tek seferde belirleyeceğiz
        const rows = Array.from(table.querySelectorAll('tbody tr.o_data_row'));

        rows.forEach(row => {
            // "Satır Ekle" veya boş satırları her zaman göster
            if (isSpecialRow(row)) {
                row.style.display = '';
                return;
            }

            // Eğer hiç filtre yoksa, tüm normal satırları göster
            if (!hasActiveFilters) {
                row.style.display = '';
                return;
            }

            // Tüm aktif filtreleri kontrol et
            let shouldShow = true;

            // Her sütun filtresi için kontrol et
            for (const [columnName, allowedValues] of Object.entries(tableFilters)) {
                // Sütun indeksini bul
                const columnIndex = findColumnIndexByName(table, columnName);
                if (columnIndex === -1) continue; // Sütun bulunamadıysa atla

                // Hücredeki değeri al
                const cell = row.querySelector(`td:nth-child(${columnIndex + 1})`);
                if (!cell) continue; // Hücre bulunamadıysa atla

                const cellValue = cell.getAttribute('data-tooltip') || cell.textContent.trim();

                // Eğer değer, izin verilen değerler arasında değilse, satırı gizle
                if (!allowedValues.includes(cellValue)) {
                    shouldShow = false;
                    break; // Bir filtre bile eşleşmezse, diğer filtreleri kontrol etmeye gerek yok
                }
            }

            // Satırın görünürlüğünü ayarla
            row.style.display = shouldShow ? '' : 'none';
        });
    }

    // Find column index by name
    function findColumnIndexByName(table, columnName) {
        const headerCells = Array.from(table.querySelectorAll('thead tr th'));
        for (let i = 0; i < headerCells.length; i++) {
            if (headerCells[i].getAttribute('data-name') === columnName) {
                return i;
            }
        }
        return -1; // Not found
    }

    // Update filter icon state (active/inactive)
    function updateFilterIconState(table, columnName, isActive) {
        const filterIcon = table.querySelector(`.${config.filterIconClass}[data-column="${columnName}"]`);
        if (filterIcon) {
            if (isActive) {
                filterIcon.classList.add(config.filterActiveClass);
            } else {
                filterIcon.classList.remove(config.filterActiveClass);
            }
        }
    }

    // Setup mutation observer to watch for new tables or changes to column visibility
    function setupMutationObserver() {
        const observer = new MutationObserver((mutations) => {
            let shouldProcessTables = false;

            for (const mutation of mutations) {
                // If nodes were added to the document, check if any are tables or contain tables
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (isOdooTable(node) || node.querySelector(config.tableSelector)) {
                                shouldProcessTables = true;
                                break;
                            }
                        }
                    }
                }

                // If attributes changed on a table column, it might be the visibility
                if (mutation.type === 'attributes' &&
                    mutation.attributeName === 'style' &&
                    mutation.target.tagName === 'TH') {

                    const table = mutation.target.closest('table');
                    if (table && isOdooTable(table)) {
                        // Re-add filter to this header if it's now visible
                        const index = Array.from(table.querySelectorAll('thead tr th')).indexOf(mutation.target);
                        if (index !== -1 && window.getComputedStyle(mutation.target).display !== 'none') {
                            addFilterToHeader(mutation.target, table, index);
                        }
                    }
                }
            }

            if (shouldProcessTables) {
                processAllTables();
            }
        });

        // Observe the whole document for changes
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style']
        });

        return observer;
    }

    // Setup event listener for column visibility changes through Odoo's column selection dropdown
    function setupColumnVisibilityEventListener() {
        document.addEventListener('click', (event) => {
            // Check if user clicked on a column visibility toggle in Odoo's dropdown
            const target = event.target;

            // Odoo places the optional columns in a dropdown with checkboxes
            // The parent element of these checkboxes usually has a class like 'dropdown-item'
            if (target.tagName === 'INPUT' &&
                target.type === 'checkbox' &&
                target.closest('.o_optional_columns_dropdown') &&
                target.closest('.dropdown-item')) {

                // Wait a bit for Odoo to update the column visibility
                setTimeout(() => {
                    processAllTables();
                }, 100);
            }
        });
    }

    // Extract a unique signature for an Odoo page from its URL
    // This is used to detect when the user navigates to a different page/document
    function getOdooPageSignatureFromUrl() {
        const url = new URL(window.location.href);
        const hash = url.hash;

        if (!hash) return '';

        // Extract parameters from the URL hash
        // Example hash: #action=123&model=sale.order&view_type=list&id=456
        const params = {};
        hash.substring(1).split('&').forEach(param => {
            const [key, value] = param.split('=');
            if (key && value) params[key] = value;
        });

        // Generate a signature combining model, view_type, action, and id
        return `${params.model || ''}_${params.view_type || ''}_${params.action || ''}_${params.id || ''}`;
    }

    // Track the last page signature to detect navigation
    let lastPageSignature = '';

    // Clear all filters when the page changes
    function clearAllFilters() {
        // Get current page signature
        const currentPageSignature = getOdooPageSignatureFromUrl();

        // If the page signature has changed, clear all filters
        if (currentPageSignature !== lastPageSignature) {
            console.log('Odoo Excel Filter: Page changed, clearing filters');
            console.log('Previous:', lastPageSignature);
            console.log('Current:', currentPageSignature);

            // Clear all active filters
            state.activeFilters.clear();
            state.columnFilterValues.clear();

            // Update lastPageSignature
            lastPageSignature = currentPageSignature;

            // Yeni tablolarda filtre simgelerini aktifleştirmek için tabloları yeniden işle
            setTimeout(processAllTables, 500);

            return true; // Filtreler temizlendi
        }

        return false; // Filtreler temizlenmedi (aynı sayfa)
    }

    // Setup page navigation listener for Odoo
    function setupNavigationListener() {
        // İlk sayfa imzasını kaydet
        lastPageSignature = getOdooPageSignatureFromUrl();
        console.log('Odoo Excel Filter: Initial page signature:', lastPageSignature);

        // Odoo kullanır "hashchange" olayını URL değişimlerini izlemek için - bu evrak değişimleri için önemli
        window.addEventListener('hashchange', () => {
            clearAllFilters();
        });

        // Odoo bazen pushState kullanarak sayfa geçişi yapabilir,
        // bu nedenle "popstate" olayını da dinleyelim
        window.addEventListener('popstate', () => {
            clearAllFilters();
        });

        // DOM değişiklikleri ile gözlenebilen navigasyon değişiklikleri için
        // Bu özellikle aynı model içinde farklı kayıtlara geçişleri yakalamak için önemli
        const contentObserver = new MutationObserver((mutations) => {
            // Tablolarda değişiklik olup olmadığını kontrol et
            let tableChanged = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    // Eklenen veya çıkarılan elementler arasında tablo var mı diye kontrol et
                    const containsTable = Array.from(mutation.addedNodes).some(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            return node.tagName === 'TABLE' || node.querySelector('table');
                        }
                        return false;
                    });
                    if (containsTable) {
                        tableChanged = true;
                        break;
                    }
                }
            }
            if (tableChanged) {
                // Tablo değişimi algılandı - filtreleri temizle
                clearAllFilters();
            }
        });

        // Ana içerik konteynerini bul ve gözlemle
        const contentContainer = document.querySelector('.o_content') || document.body;
        contentObserver.observe(contentContainer, {
            childList: true,
            subtree: true
        });

        // Periyodik kontrol - her saniye URL'yi kontrol et (yedek olarak)
        const intervalId = setInterval(() => {
            clearAllFilters(); // ID değişmişse temizler, değişmemişse bir şey yapmaz
        }, 1000);

        return {
            contentObserver,
            intervalId
        };
    }

    // Initialize the script
    function initialize() {
        console.log('Initializing Odoo 17 Excel-like Table Filtering...');

        // Add styles
        addStyles();

        // Process existing tables
        processAllTables();

        // Setup mutation observer to catch dynamically added tables and column visibility changes
        const tableObserver = setupMutationObserver();

        // Setup column visibility event listener (for Odoo's show/hide columns menu)
        setupColumnVisibilityEventListener();

        // Setup navigation listener to clear filters on page change
        const navigObservers = setupNavigationListener();

        // Also check periodically for new tables (backup for cases where mutation observer misses)
        const intervalId = setInterval(processAllTables, config.refreshInterval);

        // Return cleanup function
        return () => {
            tableObserver.disconnect();
            navigObservers.contentObserver.disconnect();
            clearInterval(navigObservers.intervalId);
            clearInterval(intervalId);
        };
    }

    // Run the initialization
    const cleanup = initialize();

    // Cleanup on page unload
    window.addEventListener('unload', cleanup);
})();