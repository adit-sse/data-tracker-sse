'use client';

import { useState, useRef, useEffect } from 'react';

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  label: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  initialViewDate?: string; // Used to sync calendar view with another date
}

export default function DatePicker({
  value,
  onChange,
  label,
  required = false,
  disabled = false,
  placeholder = 'YYYY-MM-DD',
  initialViewDate
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [viewDate, setViewDate] = useState(
    value ? new Date(value) : new Date()
  );
  
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    setInputValue(value);
    if (value) {
      setViewDate(new Date(value));
    }
  }, [value]);
  
  // When calendar opens, sync to initialViewDate if provided and no value is set
  useEffect(() => {
    if (isOpen && initialViewDate && !value) {
      const syncDate = new Date(initialViewDate);
      if (!isNaN(syncDate.getTime())) {
        setViewDate(syncDate);
      }
    }
  }, [isOpen, initialViewDate, value]);

  // Also update the calendar view when `initialViewDate` changes
  // This ensures related pickers (e.g., end date) show the same month/year
  // as a recently-selected start date.
  useEffect(() => {
    if (initialViewDate) {
      const syncDate = new Date(initialViewDate);
      if (!isNaN(syncDate.getTime())) {
        // Only update if month/year differ to avoid unnecessary state updates
        if (
          syncDate.getFullYear() !== viewDate.getFullYear() ||
          syncDate.getMonth() !== viewDate.getMonth()
        ) {
          setViewDate(syncDate);
        }
      }
    }
  }, [initialViewDate]);
  
  // Close calendar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);
  
  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    
    // Validate and update if valid date
    if (/^\d{4}-\d{2}-\d{2}$/.test(newValue)) {
      const date = new Date(newValue);
      if (!isNaN(date.getTime())) {
        onChange(newValue);
        setViewDate(date);
      }
    }
  };
  
  const handleInputBlur = () => {
    // If input is empty or invalid, reset to current value
    if (!inputValue || !/^\d{4}-\d{2}-\d{2}$/.test(inputValue)) {
      setInputValue(value);
    }
  };
  
  const handleDateSelect = (date: Date) => {
    const formattedDate = formatDate(date);
    onChange(formattedDate);
    setInputValue(formattedDate);
    setIsOpen(false);
  };
  
  const handleYearChange = (year: number) => {
    const newDate = new Date(viewDate);
    newDate.setFullYear(year);
    setViewDate(newDate);
  };
  
  const handleMonthChange = (month: number) => {
    const newDate = new Date(viewDate);
    newDate.setMonth(month);
    setViewDate(newDate);
  };
  
  const getDaysInMonth = (date: Date): Date[] => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    
    const days: Date[] = [];
    
    // Add padding days from previous month
    const firstDayOfWeek = firstDay.getDay();
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      days.push(new Date(year, month - 1, prevMonthLastDay - i));
    }
    
    // Add current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    
    // Add padding days from next month
    const remainingDays = 42 - days.length; // 6 rows × 7 days
    for (let i = 1; i <= remainingDays; i++) {
      days.push(new Date(year, month + 1, i));
    }
    
    return days;
  };
  
  const isSelectedDate = (date: Date): boolean => {
    if (!value) return false;
    const selected = new Date(value);
    return (
      date.getFullYear() === selected.getFullYear() &&
      date.getMonth() === selected.getMonth() &&
      date.getDate() === selected.getDate()
    );
  };
  
  const isToday = (date: Date): boolean => {
    const today = new Date();
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };
  
  const isCurrentMonth = (date: Date): boolean => {
    return date.getMonth() === viewDate.getMonth();
  };
  
  const yearOptions = Array.from({ length: 21 }, (_, i) => 
    new Date().getFullYear() - 10 + i
  );
  
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  const days = getDaysInMonth(viewDate);
  
  return (
    <div className="relative" ref={containerRef}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onFocus={() => !disabled && setIsOpen(true)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      </div>
      
      {isOpen && (
        <div className="absolute z-50 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3 w-80">
          {/* Month and Year Selectors */}
          <div className="flex gap-2 mb-3">
            <select
              value={viewDate.getMonth()}
              onChange={(e) => handleMonthChange(parseInt(e.target.value))}
              className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {monthNames.map((month, index) => (
                <option key={index} value={index}>
                  {month}
                </option>
              ))}
            </select>
            
            <select
              value={viewDate.getFullYear()}
              onChange={(e) => handleYearChange(parseInt(e.target.value))}
              className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          
          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {weekDays.map((day) => (
              <div
                key={day}
                className="text-center text-xs font-medium text-gray-600 py-1"
              >
                {day}
              </div>
            ))}
            
            {days.map((date, index) => {
              const selected = isSelectedDate(date);
              const today = isToday(date);
              const currentMonth = isCurrentMonth(date);
              
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => handleDateSelect(date)}
                  className={`
                    p-1.5 text-sm rounded hover:bg-blue-100 transition-colors
                    ${!currentMonth ? 'text-gray-400' : 'text-gray-900'}
                    ${selected ? 'bg-blue-600 text-white hover:bg-blue-700' : ''}
                    ${today && !selected ? 'font-bold border border-blue-600' : ''}
                  `}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          
          {/* Quick Actions */}
          <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between">
            <button
              type="button"
              onClick={() => {
                const today = new Date();
                handleDateSelect(today);
              }}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Today
            </button>
            
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-sm text-gray-600 hover:text-gray-700"
            >
              Close
            </button>
          </div>
        </div>
      )}
      
      <p className="text-xs text-gray-500 mt-1">
        You can type the date (YYYY-MM-DD) or use the calendar picker
      </p>
    </div>
  );
}