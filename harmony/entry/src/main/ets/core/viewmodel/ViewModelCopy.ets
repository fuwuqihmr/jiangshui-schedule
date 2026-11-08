// 职责：视图模型文案注入契约（纯类型，无中文/无 Kit）。
// 依赖方向：core/viewmodel 只依赖 core/types 的 import type。
// 阶段：P2 页面通过 ViewModelCopyFactory 注入文案。
// 待确认：文案键集合以规格 §3.6 为准。

export interface StatusCopy {
  normal: string;
  leaveApproved: string;
  leavePending: string;
  moved: string;
  vacant: string;
  study: string;
  cancelled: string;
}

export interface TagCopy {
  custom: string;
  makeup: string;
  modified: string;
  conflict: string;
  overlap: string;
}

export interface SourceCopy {
  school: string;
  custom: string;
  study: string;
  local: string;
}

export interface ChangeCopy {
  today: string;
  earlier: string;
  emptyTitle: string;
  emptyHint: string;
  allRead: string;
  openDay: string;
  markRead: string;
  typeAdd: string;
  typeRemove: string;
  typeUpdate: string;
  typeTime: string;
  typeRoom: string;
  typeTeacher: string;
  unread: string;
}

export interface DetailCopy {
  title: string;
  time: string;
  room: string;
  teacher: string;
  source: string;
  status: string;
  moved: string;
  leave: string;
  close: string;
}

export interface ViewModelCopy {
  weekdays: string[];
  titleToday: string;
  titleTomorrow: string;
  titleYesterday: string;
  titleSelected: string;
  weekLabel: string;
  periodLabel: string;
  movedTo: string;
  dayEmptyTitle: string;
  dayEmptyHint: string;
  sampleLabel: string;
  status: StatusCopy;
  tags: TagCopy;
  sources: SourceCopy;
  changes: ChangeCopy;
  detail: DetailCopy;
  a11yCourse: string;
  a11yMoved: string;
  a11yChange: string;
}

export function emptyViewModelCopy(): ViewModelCopy {
  return {
    weekdays: ['', '', '', '', '', '', ''],
    titleToday: '',
    titleTomorrow: '',
    titleYesterday: '',
    titleSelected: '',
    weekLabel: '',
    periodLabel: '',
    movedTo: '',
    dayEmptyTitle: '',
    dayEmptyHint: '',
    sampleLabel: '',
    status: {
      normal: '',
      leaveApproved: '',
      leavePending: '',
      moved: '',
      vacant: '',
      study: '',
      cancelled: ''
    },
    tags: { custom: '', makeup: '', modified: '', conflict: '', overlap: '' },
    sources: { school: '', custom: '', study: '', local: '' },
    changes: {
      today: '',
      earlier: '',
      emptyTitle: '',
      emptyHint: '',
      allRead: '',
      openDay: '',
      markRead: '',
      typeAdd: '',
      typeRemove: '',
      typeUpdate: '',
      typeTime: '',
      typeRoom: '',
      typeTeacher: '',
      unread: ''
    },
    detail: {
      title: '',
      time: '',
      room: '',
      teacher: '',
      source: '',
      status: '',
      moved: '',
      leave: '',
      close: ''
    },
    a11yCourse: '',
    a11yMoved: '',
    a11yChange: ''
  };
}
