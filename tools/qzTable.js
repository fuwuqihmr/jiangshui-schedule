$(function () {
    // qz-search 跟随分辨率计算按钮,以及隐藏
    $('.qz-search').length && calcQzSearch();
    // qz-search 展开|收缩
    expland();

    initQzSearch();

    window.onresize = () => {
        $('.qz-table').each((index, qzTable) => {
            let page = !!$(qzTable).find('.layui-table-page').length;
            calcQzTableHeight($(qzTable).find('.qz-table-content')[0], page);
        });
    };
});

function initQzSearch() {
    layui.use('form', function () {
        var form = layui.form;
        var $ = layui.$;
        layui.isValidate = true;
        form.verify({
            username: function (value, item) {
                //value：表单的值、item：表单的DOM对象
                //我们既支持上述函数式的方式，也支持下述数组的形式
                //数组的两个值分别代表：[正则匹配、匹配不符时的提示文字]
                if (!new RegExp('^[a-zA-Z0-9_\u4e00-\u9fa5\\s·]+$').test(value)) {
                    qzError(item, '用户名不能有特殊字符');
                }
                if (/(^\_)|(\__)|(\_+$)/.test(value)) {
                    qzError(item, "用户名首尾不能出现下划线'_'");
                }
                if (/^\d+\d+\d$/.test(value)) {
                    qzError(item, "用户名不能全为数字'_'");
                }
            },
            email: function (value, item) {
                //value：表单的值、item：表单的DOM对象
                if (new RegExp(/^([a-zA-Z0-9_\.\-])+\@(([a-zA-Z0-9\-])+\.)+([a-zA-Z0-9]{2,4})+$/).test(value) || !new RegExp(/[\S]+/).test(value)) {
                    qzSuccess(item);
                } else {
                    qzError(item, '邮箱格式不正确');
                }
            },
            phone: function (value, item) {
                //value：表单的值、item：表单的DOM对象
                if (new RegExp(/^1\d{10}$/).test(value) || !new RegExp(/[\S]+/).test(value)) {
                    qzSuccess(item);
                } else {
                    qzError(item, '请输入正确的手机号');
                }
            },
            required: function (value, item) {
                //value：表单的值、item：表单的DOM对象
                if (new RegExp(/[\S]+/).test(value)) {
                    qzSuccess(item);
                } else {
                    qzError(item, '必填项不能为空');
                }
            },
            requiredNoMsg: function (value, item) {
                //value：表单的值、item：表单的DOM对象
                if (new RegExp(/[\S]+/).test(value)) {
                    qzSuccess(item);
                } else {
                    qzError(item);
                }
            },
            pass: [/^[\S]{6,12}$/, '密码必须6到12位，且不能出现空格'],
        });
    });
}

// qz-search 跟随分辨率计算按钮,以及隐藏
function calcQzSearch() {
    $('.qz-search').each((index, qzSearch) => {
        let width = $(qzSearch).width();
        let colWidth = 0;
        let num = $(qzSearch).data('num');
        if (num) {
            colWidth = getWidth(qzSearch, width, Number(num));
        } else if (width > 1600) {
            colWidth = getWidth(qzSearch, width, 6);
        } else if (width > 1300) {
            colWidth = getWidth(qzSearch, width, 5);
        } else if (width > 1000) {
            colWidth = getWidth(qzSearch, width, 4);
        } else {
            colWidth = getWidth(qzSearch, width, 3);
        }
        $(qzSearch).find('.layui-form-item').outerWidth(colWidth);
    });
}

function getWidth(qzSearch, width, num) {
    let colWidth = Math.floor(width / num);
    if (!$(qzSearch).hasClass('qz-dialogForm')) {
        let items = $(qzSearch).children();
        if (items.length < num + 1) {
            $(qzSearch).find('.layui-btn[expland]').hide();
        }
        $(items[num - 2]).after($(qzSearch).find('.qz-search-btn'));
        items = $(qzSearch).children();
        items.each((iindex, item) => {
            if (iindex > num - 1) {
                $(item).addClass('hidden');
                $(item).hide();
            }
        });
    }
    return colWidth;
}

// qz-search 展开|收缩
function expland() {
    $('.qz-search .layui-btn[expland]').on('click', e => {
        let height = $(e.currentTarget).parents('.qz-search').outerHeight();
        $(e.currentTarget).parents('.qz-search').find('.hidden').toggle();
        let newHeight = $(e.currentTarget).parents('.qz-search').outerHeight();
        $(e.currentTarget).find('iconpark-icon').toggleClass('expland');
        calcQzTableExplandHeight(newHeight - height);
    });
}

// qz-form 验证错误
window.qzError = function (item, msg) {
    if ($(item).parents('.layui-form-pane').length) {
        $(item).parent('.layui-input-inline,.layui-input-block').addClass('qz-warning-item');
    } else {
        $(item).parent().find('.qz-warning').remove();
        msg && $(item).after(`<div class="qz-warning">${msg}</div>`);
        $(item).addClass('qz-warning-item');
        $(item).parent().find('input,textarea').addClass('qz-warning-item border');
    }
    layui.isValidate = false;
};

// qz-form 验证成功
window.qzSuccess = function (item) {
    $(item).parents('.layui-input-inline,.layui-input-block').removeClass('qz-warning-item');
    $(item).parent().find('.qz-warning').remove();
    $(item).parent().find('input,textarea').removeClass('qz-warning-item border');
    layui.isValidate = true;
};

// qz-table 表格初始化
window.initQzTable = function ({
                                   tableId,
                                   searchId,
                                   cols,
                                   url,
                                   data,
                                   params,
                                   page,
                                   tableHeight,
                                   done,
                                   rowClick,
                                   parseData,
                                   rowDoubleClick,
                                   choose,
                                   dealData
                               }) {
    var className = '';
    if ($('#jbbjys').val() != null && $('#jbbjys').val() != undefined) {
        className = $('#jbbjys').val();
    } else {
        var parentJbbjys = window.parent.parent.document.getElementById("bjysdm");
        if (parentJbbjys != null && parentJbbjys != undefined) {
            className = parentJbbjys.value;
        }
    }
    layui.use(['form', 'table'], function () {
        var table = layui.table;
        var form = layui.form;
        var util = layui.util;
        let tableContent = $(`#${tableId}`).parents('.qz-table-content')[0];
        let search = $(`#${searchId}`);
        let searchFilter = '';
        let listData = [];
        let options = {
            id: tableId,
            elem: `#${tableId}`,
            loading: false,
            tableHeight: tableHeight,
            className: className,
            request: {
                pageName: 'pageNum', //页码的参数名称，默认：page
                limitName: 'pageSize', //每页数据量的参数名，默认：limit
            },
            page: {
                //支持传入 laypage 组件的所有参数（某些参数除外，如：jump/elem） - 详见文档
                layout: ['count', 'prev', 'page', 'next', 'skip'], //自定义分页布局
                //,curr: 5 //设定初始在第 5 页
                limit: 20,
                groups: 5, //只显示 1 个连续页码
                first: false, //不显示首页
                last: false, //不显示尾页
            },
            dealData: (res, curr, count) => {
                dealData && dealData(res, curr, count);
            },
            done: (res, curr, count) => {
                done && done(res, curr, count);

                if (tableHeight !== false) {
                    calcQzTableHeight(tableContent, page);
                }

                listData = res.data;

                $(function () {
                    if ($(tableContent).find('td .laytable-cell-operate').width() < 20) {
                        $(tableContent).find('.laytable-cell-operate').hide();
                    } else {
                        $(tableContent).find('.laytable-cell-operate').show();
                        $(tableContent).find('th .laytable-cell-operate').width($(tableContent).find('td .laytable-cell-operate').width());
                    }

                    let normalNum = cols[0].filter(item => item.type === 'normal' && !item.hide).length;
                    if (normalNum <= 8) {
                        $(tableContent).find('.layui-table-body.layui-table-main').css('overflow-x', 'hidden');
                    }
                    table.reScroll();
                });

                if (choose && choose.value) {
                    table.getOptions(tableId).choose = choose;
                    show(tableId, choose);
                    if (choose.chooseValue && choose.chooseValue.length) {
                        res.data.forEach((element, index) => {
                            let chooseObj = choose.chooseValue.filter(item => item.value === element[choose.value] && item.label === element[choose.label]);
                            if (chooseObj.length) {
                                $(tableContent).find(`tr[data-index=${index}] .layui-form-checkbox`)[0].click();
                            }
                        });
                    } else {
                        choose.chooseValue = [];
                    }
                }

                // data没有
                showEmpty(tableId, res.data && res.data.length);

                window.qzTips('th .layui-table-cell', {tips: 3});
                window.qzTips('td .laytable-cell-normal');

                const fixedDomList = document.querySelectorAll('.layui-table-view .layui-table-fixed .layui-table-body')
                const jbtable = document.querySelectorAll('.layui-table-view .layui-table-box')[0]
                const tableFixed = document.querySelectorAll('.layui-table-view .layui-table-fixed')[0]

                const jbtableHeight = jbtable ? parseInt(getComputedStyle(jbtable).height, 10) : 0
                const fixedHeight = tableFixed ? parseInt(getComputedStyle(tableFixed).height, 10) : 0

                // console.log(fixedHeight, jbtableHeight, '@@@')
                if (fixedHeight && jbtableHeight) {
                    let transparency10 = (fixedHeight / jbtableHeight) * 34
                    transparency10 = Math.floor(transparency10)
                    let transparency16 = transparency10.toString(16)
                    // console.log(transparency16, 'transparency16')
                    if (transparency16.length === 1) {
                        transparency16 = '0' + transparency16
                    }
                    let backgroundImage;
                    if (document.querySelectorAll('.layui-table-view.bg-6957B1')[0]) {
                        backgroundImage = "linear-gradient(180deg, #6957B101 1%, #6957B1" + transparency16 + " 98%)"
                    }
                    if (document.querySelectorAll('.layui-table-view.bg-3F7ADB')[0]) {
                        backgroundImage = "linear-gradient(180deg, #3F7ADB01 1%, #3F7ADB" + transparency16 + " 98%)"
                    }
                    if (document.querySelectorAll('.layui-table-view.bg-B5332B')[0]) {
                        backgroundImage = "linear-gradient(180deg, #B5332B 1%, #B5332B" + transparency16 + " 98%)"
                    }
                    if (document.querySelectorAll('.layui-table-view.bg-33706C')[0]) {
                        backgroundImage = "linear-gradient(180deg, #33706C01 1%, #33706C" + transparency16 + " 98%)"
                    }
                    if (document.querySelectorAll('.layui-table-view.bg-F39644')[0]) {
                        backgroundImage = "linear-gradient(180deg, #F3964401 1%, #F39644" + transparency16 + " 98%)"
                    }
                    if (document.querySelectorAll('.layui-table-view.bg-00A0DF')[0]) {
                        backgroundImage = "linear-gradient(180deg, #00A0DF01 1%, #00A0DF" + transparency16 + " 98%)"
                    }
                    if (document.querySelectorAll('.layui-table-view.bg-17B362')[0]) {
                        backgroundImage = "linear-gradient(180deg, #17B36201 1%, #17B362" + transparency16 + " 98%)"
                    }
                    if (document.querySelectorAll('.layui-table-view.bg-313644')[0]) {
                        backgroundImage = "linear-gradient(180deg, #31364401 1%, #313644" + transparency16 + " 98%)"
                    }

                    console.log(backgroundImage, 'backgroundImage')
                    for (let i = 0; i < fixedDomList.length; i++) {
                        fixedDomList[i].style.background = backgroundImage
                    }
                }

            },
            error: () => {
                showEmpty(tableId, false);
            },
        };
        parseData && (options.parseData = parseData);
        if (page === false) {
            options.page = '';
        }

        if (url) {
            options.url = url;
            options.saveUrl = url;

            if (searchId) {
                if (search.attr('lay-filter')) {
                    searchFilter = search.attr('lay-filter');
                } else {
                    search.attr('lay-filter', searchId);
                }
                let obj = form.val(searchFilter);
                params && Object.assign(obj, params);
                options.where = obj;
            } else {
                options.where = params;
            }
        } else if (data) {
            options.data = data;
        } else {
            options.data = [];
        }

        $(function () {
            if (tableHeight !== false) {
                tableHeight = '0';
            }
            options.height = tableHeight;
            // qz-table 表格宽度计算
            options.cols = calcQzTableWidth(cols, tableContent);

            table.render(options);

            // data没有
            if (data) {
                showEmpty(tableId, data.length);
            }
        });

        //监听表格复单双击事件
        table.on(`row(${tableId})`, function (obj) {
            // 获取当前行对象
            let checkbox = $(obj.tr).find('.layui-form-checkbox')[0];
            checkbox && checkbox.click();
            // 获取当前行数据
            // console.log(obj.data);
            // obj.del() // 删除当前行
            // obj.update(field); // 修改当前行数据
            rowClick && rowClick(obj);
        });

        //监听表格复单双击事件
        table.on(`rowDouble(${tableId})`, function (obj) {
            // 获取当前行对象
            // $(obj.tr)
            // 获取当前行数据
            // console.log(obj.data);
            // obj.del() // 删除当前行
            // obj.update(field); // 修改当前行数据
            rowDoubleClick && rowDoubleClick(obj);
        });

        util.on('lay-on', {
            close: othis => {
                let value = $(othis).parent().attr('value');
                let newValueArr = choose.chooseValue.filter(item => item.value !== value);
                choose.chooseValue = newValueArr;

                let arr = listData.filter((item, index) => {
                    return value == item[choose.value];
                });
                arr[0] && $(othis).parents(`.qz-table`).find(`tr[data-index=${arr[0].LAY_INDEX}] .layui-form-checkbox`)[0].click();

                $(othis).parent().remove();
            },
        });
    });
};

// qz-table 表格重载
window.reloadTable = function ({tableId, searchId, params, curr, data, done, url, choose}) {
    layui.use(['table', 'form'], function () {
        var form = layui.form;
        let tableContent = $(`#${tableId}`).parents('.qz-table-content')[0];
        let listData = [];

        let search = $(`#${searchId}`);
        let searchFilter = '';

        var table = layui.table;
        let options = table.getOptions(tableId);

        let newOptions = {};

        newOptions.url = options.saveUrl;
        url != undefined && (newOptions.url = url);
        if (options.page) {
            newOptions.page = options.page;
            curr && (newOptions.page.curr = curr);
        }
        if (done) {
            newOptions.done = (res, curr, count) => {
                done && done(res, curr, count);

                if (newOptions.tableHeight !== false) {
                    calcQzTableHeight(tableContent, newOptions.page);
                }

                listData = res.data;

                $(function () {
                    if ($(tableContent).find('td .laytable-cell-operate').width() < 20) {
                        $(tableContent).find('.laytable-cell-operate').hide();
                    } else {
                        $(tableContent).find('.laytable-cell-operate').show();
                        $(tableContent).find('th .laytable-cell-operate').width($(tableContent).find('td .laytable-cell-operate').width());
                    }
                });

                if (choose && choose.value) {
                    table.getOptions(tableId).choose = choose;
                    show(tableId, choose);
                    if (choose.chooseValue && choose.chooseValue.length) {
                        res.data.forEach((element, index) => {
                            let chooseObj = choose.chooseValue.filter(item => item.value === element[choose.value] && item.label === element[choose.label]);
                            if (chooseObj.length) {
                                $(tableContent).find(`tr[data-index=${index}] .layui-form-checkbox`)[0].click();
                            }
                        });
                    } else {
                        choose.chooseValue = [];
                    }
                }

                // data没有
                showEmpty(tableId, res.data && res.data.length);

                window.qzTips('th .layui-table-cell', {tips: 3});
                window.qzTips('td .laytable-cell-normal');
            };
        }

        if (searchId) {
            $(search).find('.hidden').hide();
            if (search.attr('lay-filter')) {
                searchFilter = search.attr('lay-filter');
            } else {
                search.attr('lay-filter', searchId);
            }

            newOptions.where = form.val(searchFilter);
        }

        params && (newOptions.where = params);

        if (data) {
            newOptions.url = '';
            newOptions.where = {};
            newOptions.data = data;
        }
        // qz-table 表格宽度计算
        newOptions.cols = calcQzTableWidth(options.cols, tableContent);
        // 执行重载
        table.reloadData(tableId, newOptions);
    });
};

window.calcQzTableHeight = function (tableContent, page) {
    // qz-table 表格高度计算
    let qzTableParent = $(tableContent).parents('.qz-table');
    let top = tableContent.getBoundingClientRect().top - qzTableParent[0].getBoundingClientRect().top;
    let headerAndPage = $(tableContent).find('.layui-table-header').height() + $(tableContent).find('.layui-table-page').outerHeight();

    if ($(tableContent).find('.layui-table-body.layui-table-main').height() === 0) {
        let height = qzTableParent.outerHeight() - headerAndPage - top;
        if (page === false) {
            height -= 12;
        }
        $(tableContent).find('.layui-table-body.layui-table-main').height(height);

        // table 宽度变化fixed列消失处理
        if ($(tableContent).find('.layui-table-fixed .layui-table-body').height() <= 0) {
            const lCell = $(tableContent).find('.layui-table-fixed.layui-table-fixed-l .layui-table-body tbody tr');
            const rCell = $(tableContent).find('.layui-table-fixed.layui-table-fixed-r .layui-table-body tbody tr');
            if (lCell.length) {
                $(tableContent)
                    .find('.layui-table-fixed .layui-table-body')
                    .height(lCell.height() * lCell.length);
                $(tableContent).find('.layui-table-fixed.layui-table-fixed-l').css('left', 0);
                if (rCell.length) {
                    $(tableContent).find('.layui-table-fixed.layui-table-fixed-r').css('right', 0);
                }
                return;
            }
            if (rCell.length) {
                $(tableContent)
                    .find('.layui-table-fixed .layui-table-body')
                    .height(rCell.height() * rCell.length);
                $(tableContent).find('.layui-table-fixed.layui-table-fixed-r').css('right', 0);
            }
        }
    } else {
        // let height = qzTableParent.outerHeight() - top - 12;
        // $(tableContent).css({ height: height + 'px', overflow: 'auto' });
    }
};

function showEmpty(tableId, flag) {
    let qzTableParent = $(`#${tableId}`).parents('.qz-table');
    let tableContent = $(`#${tableId}`).parents('.qz-table-content')[0];
    let headerAndPage = $(tableContent).find('.layui-table-header').height();
    let top = tableContent.getBoundingClientRect().top - qzTableParent[0].getBoundingClientRect().top;
    let height = qzTableParent.outerHeight() - headerAndPage - top - 12;
    let mainBody = $(tableContent).find('.layui-table-body.layui-table-main');
    if (flag) {
        $(tableContent).find('.layui-table-box').removeAttr('style');
        $(tableContent).find('.layui-table-header').removeAttr('style');
        mainBody.children().show();
        // 表格数据不为空时，恢复table-page的高度
        $(tableContent).find('.layui-table-page').css('height', '');
        // 或者显示table-page
        $(tableContent).find('.layui-table-page').show();
        $(tableContent).find('.qz-table-empty').remove();
        qzTableParent.removeClass('empty');
    } else {
        $(tableContent).find('.layui-none').remove();
        $(tableContent).find('.layui-table-box').css('overflow-x', 'auto');
        $(tableContent).find('.layui-table-header').css('overflow', 'unset');
        // 设置table-page的高度为0
        $(tableContent).find('.layui-table-page').css('height', '0');
        // 或者隐藏table-page
        $(tableContent).find('.layui-table-page').hide();
        if (!$(tableContent).find('.qz-table-empty').length) {
            mainBody.height('auto');
            mainBody.children().hide();
            mainBody.append(`<div style="height:${height}px" class="qz-table-empty"><span>未查询到相关数据</span></div>`);
        }
    }
}

// qz-table 表格高度计算
function calcQzTableExplandHeight(calcHeight) {
    let qzTables = $('.qz-table .qz-table-content');
    let num = qzTables.length;
    qzTables.each((index, tableContent) => {
        if ($(tableContent).parent('.qz-table').css('max-height') !== 'none') {
            num--;
        }
    });
    qzTables.each((index, tableContent) => {
        let obj = $(tableContent).find('.layui-table-body');
        let height = calcHeight / num;
        if ($(tableContent).parent('.qz-table').css('max-height') === 'none') {
            obj.css('height', `${obj.height() - height}px`);
            obj.find('.qz-table-empty').length && obj.find('.qz-table-empty').css('height', obj.css('height'));
        }
    });
}

// qz-table 表格宽度计算
window.calcQzTableWidth = function (cols, tableContent) {
    let colWidths = $(tableContent).width() - 2;
    // console.log(colWidths, 'colWidths')
    // debugger
    let specialWidth = 0;
    let colWidth = 0;
    let endColWidth = cols[0].length - 1;
    // 计算数量
    let length = 8;
    let normalNum = cols[0].filter(item => (!item.type || item.type === 'normal') && !item.hide).length;
    if (normalNum <= 8) {
        length = normalNum;
    }

    // 判断特殊列
    cols[0].forEach((col, colIndex) => {
        if (col.type === 'checkbox' && !col.hide) {
            specialWidth += 51;
        }
        if (col.type === 'numbers' && !col.hide) {
            col.width = 56;
            specialWidth += 57;
        }
        if (col.type === 'arrow' && !col.hide) {
            col.width = 56;
            specialWidth += 57;
        }
        if (col.type === 'operate' && !col.hide) {
            if (col.width) {
                col.style = 'min-width:' + col.width + 'px'; // 按钮宽度
                specialWidth += parseInt(col.width) + 2; // 预留宽度
            } else {
                col.style = 'width:auto;min-width:72px';
                specialWidth += 74;
            }
            endColWidth = cols[0].length - 2;
        }
    });

    // 去掉额外的宽度,计算每列宽度
    colWidths -= specialWidth;
    colWidth = Math.floor(colWidths / length) - 1;

    // 如果分辨率过小，则每列撑开为100
    if (colWidth < 100) {
        colWidth = 100;
    }
    let noWidthArr = []
    cols[0].forEach((col, colIndex) => {
        if (!col.type || col.type === 'normal') {
            if (!col.width) {
                col.width = colWidth;
                noWidthArr.push(colIndex)
            }
            colWidths -= (parseInt(col.width) + 1)
        }
    });
    if (colWidths > 0) {
        let pjWidth = Math.floor(colWidths / noWidthArr.length)
        let lastWidth = colWidths - (pjWidth * noWidthArr.length)
        let lastColIndex = noWidthArr[noWidthArr.length - 1]
        noWidthArr.forEach((colIndex) => {
            cols[0][colIndex].width = cols[0][colIndex].width + pjWidth
        })

        if (cols[0][lastColIndex] != undefined) {
            // 为了美观此处额外+1
            cols[0][lastColIndex].width = cols[0][lastColIndex].width + lastWidth + 1
        }
    }

    return cols;
};

window.showQzTableBtn = function (tableId, obj) {
    let qzTableBtn = $(`#${tableId}`).parents('.qz-table').find('ul.qz-table-btn');

    let options = layui.table.getOptions(tableId);
    let choose = options.choose;
    if (obj.type === 'all') {
        if (obj.checked) {
            let tableData = layui.table.getData(tableId);
            choose.chooseValue = tableData.map(item => {
                if (!$(qzTableBtn).find(`li[value=${item[choose.value]}]`).length) {
                    $(qzTableBtn).append(`
                  <li value="${item[choose.value]}">
                    <span>${item[choose.label]}</span>
                    <iconpark-icon lay-on="close" name="close"></iconpark-icon>
                  </li>
                `);
                }
                return {
                    label: item[choose.label],
                    value: item[choose.value],
                };
            });
        } else {
            $(qzTableBtn).empty();
            choose.chooseValue = [];
        }
    } else {
        if (obj.checked) {
            if (!$(qzTableBtn).find(`li[value=${obj.data[choose.value]}]`).length) {
                choose.chooseValue.push({
                    label: obj.data[choose.label],
                    value: obj.data[choose.value],
                });
                $(qzTableBtn).append(`
                  <li value="${obj.data[choose.value]}">
                    <span>${obj.data[choose.label]}</span>
                    <iconpark-icon lay-on="close" name="close"></iconpark-icon>
                  </li>
                `);
            }
        } else {
            let arr = choose.chooseValue.filter(item => {
                return item.value !== obj.data[choose.value];
            });
            options.choose.chooseValue = arr;
            $(qzTableBtn).find(`li[value=${obj.data[choose.value]}]`).remove();
        }
    }
    return choose.chooseValue;
};

function show(tableId, choose) {
    let qzTableBtn = $(`#${tableId}`).parents('.qz-table').find('ul.qz-table-btn');
    if (qzTableBtn.length && choose.chooseValue && choose.chooseValue.length) {
        choose.chooseValue.forEach((item, index) => {
            if (!$(qzTableBtn).find(`li[value=${item.value}]`).length) {
                $(qzTableBtn).append(`
                  <li value="${item.value}">
                    <span>${item.label}</span>
                    <iconpark-icon lay-on="close" name="close"></iconpark-icon>
                  </li>
                `);
            }
        });
    }
}

