import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DataTablePaginationProps {
  totalItems: number;
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}

export function DataTablePagination({
  totalItems,
  pageSize,
  currentPage,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
}: DataTablePaginationProps) {
  const isAll = pageSize >= totalItems;
  const totalPages = isAll ? 1 : Math.ceil(totalItems / pageSize);
  const startItem = isAll ? 1 : (currentPage - 1) * pageSize + 1;
  const endItem = isAll ? totalItems : Math.min(currentPage * pageSize, totalItems);

  // Generate visible page numbers (max 5 pages shown)
  function getPageNumbers(): number[] {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 3) return [1, 2, 3, 4, 5];
    if (currentPage >= totalPages - 2) {
      return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2];
  }

  if (totalItems === 0) return null;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border/30" data-testid="pagination">
      {/* Left: item count */}
      <span className="text-xs text-muted-foreground tabular-nums">
        Showing {startItem}–{endItem} of {totalItems} items
      </span>

      {/* Center: page size selector */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Rows:</span>
          <select
            className="text-xs bg-muted/50 border border-border/50 rounded px-1.5 py-0.5 text-foreground tabular-nums"
            value={isAll ? "all" : pageSize}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "all") {
                onPageSizeChange(totalItems);
              } else {
                onPageSizeChange(Number(val));
              }
              onPageChange(1);
            }}
            data-testid="select-page-size"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
            <option value="all">All</option>
          </select>
        </div>

        {/* Right: page navigation */}
        {!isAll && totalPages > 1 && (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={currentPage === 1}
              onClick={() => onPageChange(1)}
              data-testid="pagination-first"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={currentPage === 1}
              onClick={() => onPageChange(currentPage - 1)}
              data-testid="pagination-prev"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>

            {getPageNumbers().map((page) => (
              <Button
                key={page}
                variant={page === currentPage ? "secondary" : "ghost"}
                size="icon"
                className={`h-7 w-7 text-xs tabular-nums ${
                  page === currentPage ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground"
                }`}
                onClick={() => onPageChange(page)}
                data-testid={`pagination-page-${page}`}
              >
                {page}
              </Button>
            ))}

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={currentPage === totalPages}
              onClick={() => onPageChange(currentPage + 1)}
              data-testid="pagination-next"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={currentPage === totalPages}
              onClick={() => onPageChange(totalPages)}
              data-testid="pagination-last"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
